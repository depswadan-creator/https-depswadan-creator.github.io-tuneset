import React from 'react';
import ReactDOM from 'react-dom/client';

function getRedirectUri() { return window.location.origin + window.location.pathname; }
const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read";

async function genRandom(n) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(n); crypto.getRandomValues(arr);
  return Array.from(arr).map(x => chars[x % chars.length]).join("");
}
async function genChallenge(v) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function initiateLogin(clientId) {
  const v = await genRandom(128), c = await genChallenge(v);
  sessionStorage.setItem("sp_v", v);
  window.location.href = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: getRedirectUri(),
    scope: SCOPES, code_challenge_method: "S256", code_challenge: c,
  });
}
async function exchangeCode(code, clientId) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "authorization_code",
      code, redirect_uri: getRedirectUri(), code_verifier: sessionStorage.getItem("sp_v") }),
  });
  return r.json();
}
async function doRefresh(rt, clientId) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: rt }),
  });
  return r.json();
}

function App() {
  const [clientId, setClientId] = React.useState(localStorage.getItem("ts_cid") || "");
  const [token, setToken] = React.useState(localStorage.getItem("ts_token") || "");
  const [refreshTok, setRefreshTok] = React.useState(localStorage.getItem("ts_refresh") || "");
  const [expiry, setExpiry] = React.useState(parseInt(localStorage.getItem("ts_expiry") || "0"));
  const [view, setView] = React.useState("setup");
  const [playlists, setPlaylists] = React.useState([]);
  const [tracks, setTracks] = React.useState([]);
  const [loadingTracks, setLoadingTracks] = React.useState(false);
  const [debugMsg, setDebugMsg] = React.useState("");
  const [selectedPlaylist, setSelectedPlaylist] = React.useState(null);

  const saveToken = (t, r, exp) => {
    setToken(t); setRefreshTok(r); setExpiry(exp);
    localStorage.setItem("ts_token", t);
    if (r) localStorage.setItem("ts_refresh", r);
    localStorage.setItem("ts_expiry", String(exp));
  };

  const getToken = React.useCallback(async () => {
    if (Date.now() < expiry - 60000) return token;
    if (refreshTok && clientId) {
      const d = await doRefresh(refreshTok, clientId).catch(() => null);
      if (d && d.access_token) {
        const exp = Date.now() + d.expires_in * 1000;
        saveToken(d.access_token, d.refresh_token || refreshTok, exp);
        return d.access_token;
      }
    }
    return token;
  }, [token, refreshTok, expiry, clientId]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const cid = localStorage.getItem("ts_cid");
    if (code && cid) {
      window.history.replaceState({}, "", window.location.pathname);
      exchangeCode(code, cid).then(d => {
        if (d.access_token) saveToken(d.access_token, d.refresh_token, Date.now() + d.expires_in * 1000);
      });
    }
  }, []);

  React.useEffect(() => {
    if (!token) return;
    getToken().then(async t => {
      setView("playlists");
      const r = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      setPlaylists(d.items || []);
    });
  }, [token]);

  const handleLogin = () => {
    if (!clientId.trim()) return;
    localStorage.setItem("ts_cid", clientId.trim());
    initiateLogin(clientId.trim());
  };

  const handleLogout = () => {
    setToken(""); setRefreshTok(""); setPlaylists([]); setTracks([]);
    ["ts_token","ts_refresh","ts_expiry"].forEach(k => localStorage.removeItem(k));
    setView("setup");
  };

  const handlePlaylist = async (pl) => {
    setSelectedPlaylist(pl);
    setTracks([]);
    setDebugMsg("Loading...");
    setLoadingTracks(true);
    setView("tracks");
    try {
      const t = await getToken();
      setDebugMsg("Got token: " + t.substring(0,20) + "...");
      const url = "https://api.spotify.com/v1/playlists/" + pl.id + "/tracks?limit=50";
      setDebugMsg("Fetching: " + url);
      const r = await fetch(url, { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      setDebugMsg("Status " + r.status + " | items: " + (d.items ? d.items.length : "none") + " | error: " + (d.error ? JSON.stringify(d.error) : "none"));
      const valid = (d.items||[]).filter(i=>i.track&&i.track.id).map(i=>i.track);
      setTracks(valid);
    } catch(e) {
      setDebugMsg("CATCH ERROR: " + e.message);
    }
    setLoadingTracks(false);
  };

  const s = { page: { minHeight: "100vh", background: "#0a0a0f", fontFamily: "Georgia,serif", color: "#fff", padding: 20 } };

  if (view === "setup" || !token) return (
    <div style={s.page}>
      <h1 style={{ color: "#1DB954", marginBottom: 20 }}>🎸 TuneSet — Debug Mode</h1>
      <p style={{ color: "#888", marginBottom: 10, fontSize: 13 }}>Redirect URI (copy this into Spotify Dashboard):</p>
      <div style={{ background: "#111", border: "1px solid #1DB954", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 12, color: "#1DB954", wordBreak: "break-all", marginBottom: 20 }}>{getRedirectUri()}</div>
      <input type="text" placeholder="Paste Spotify Client ID" value={clientId} onChange={e => setClientId(e.target.value)}
        style={{ width: "100%", padding: 12, background: "#111", border: "1px solid #333", borderRadius: 8, color: "#fff", fontSize: 14, fontFamily: "monospace", outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
      <button onClick={handleLogin} disabled={!clientId.trim()} style={{ width: "100%", padding: 14, background: clientId ? "#1DB954" : "#222", color: clientId ? "#000" : "#555", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: clientId ? "pointer" : "not-allowed" }}>
        Connect to Spotify
      </button>
    </div>
  );

  if (view === "playlists") return (
    <div style={s.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Your Playlists</h2>
        <button onClick={handleLogout} style={{ background: "none", border: "1px solid #333", color: "#666", padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}>Sign out</button>
      </div>
      {playlists.map(pl => (
        <button key={pl.id} onClick={() => handlePlaylist(pl)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "#111", border: "1px solid #222", borderRadius: 10, padding: 12, marginBottom: 8, cursor: "pointer", textAlign: "left" }}>
          {pl.images && pl.images[0] ? <img src={pl.images[0].url} alt="" style={{ width: 44, height: 44, borderRadius: 6 }} /> : <div style={{ width: 44, height: 44, borderRadius: 6, background: "#222", display: "flex", alignItems: "center", justifyContent: "center" }}>♪</div>}
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{pl.name}</div>
            <div style={{ color: "#666", fontSize: 12 }}>{pl.tracks && pl.tracks.total} tracks</div>
          </div>
        </button>
      ))}
    </div>
  );

  if (view === "tracks") return (
    <div style={s.page}>
      <button onClick={() => setView("playlists")} style={{ background: "none", border: "1px solid #1DB954", color: "#1DB954", padding: "8px 14px", borderRadius: 8, cursor: "pointer", marginBottom: 16 }}>← Back</button>
      <h2 style={{ marginBottom: 12 }}>{selectedPlaylist && selectedPlaylist.name}</h2>
      <div style={{ background: "#111", border: "1px solid #ff6b35", borderRadius: 8, padding: 12, marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#ff6b35", wordBreak: "break-all" }}>
        DEBUG: {debugMsg}
      </div>
      {loadingTracks && <div style={{ color: "#666", padding: 20, textAlign: "center" }}>Loading...</div>}
      {tracks.length === 0 && !loadingTracks && <div style={{ color: "#666", padding: 20, textAlign: "center" }}>No tracks found</div>}
      {tracks.map((track, i) => (
        <div key={track.id || i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#111", borderRadius: 10, padding: 12, marginBottom: 8 }}>
          {track.album && track.album.images && track.album.images[0] ? <img src={track.album.images[0].url} alt="" style={{ width: 44, height: 44, borderRadius: 6 }} /> : <div style={{ width: 44, height: 44, borderRadius: 6, background: "#222" }} />}
          <div>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>{track.name}</div>
            <div style={{ color: "#666", fontSize: 12 }}>{track.artists.map(a => a.name).join(", ")}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return null;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(React.StrictMode, null, React.createElement(App, null)));
