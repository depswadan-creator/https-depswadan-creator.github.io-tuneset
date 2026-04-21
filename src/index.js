import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';

const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read";
function getRedirectUri() { return window.location.origin + window.location.pathname; }

const TUNINGS = [
  { id: "standard", name: "Standard", notes: "E A D G B E" },
  { id: "drop_d", name: "Drop D", notes: "D A D G B E" },
  { id: "open_g", name: "Open G", notes: "D G D G B D" },
  { id: "open_d", name: "Open D", notes: "D A D F# A D" },
  { id: "open_e", name: "Open E", notes: "E B E G# B E" },
  { id: "open_a", name: "Open A", notes: "E A E A C# E" },
  { id: "dadgad", name: "DADGAD", notes: "D A D G A D" },
  { id: "half_step", name: "Half Step Down", notes: "Eb Ab Db Gb Bb Eb" },
  { id: "full_step", name: "Full Step Down", notes: "D G C F A D" },
  { id: "drop_c", name: "Drop C", notes: "C G C F A D" },
  { id: "open_c", name: "Open C", notes: "C G C G C E" },
  { id: "double_drop_d", name: "Double Drop D", notes: "D A D G B D" },
];
const TC = {
  standard: { bg: "#0d1117", accent: "#1DB954", glow: "#1DB95422" },
  drop_d: { bg: "#0f0f1a", accent: "#e94560", glow: "#e9456022" },
  open_g: { bg: "#140f00", accent: "#f5a623", glow: "#f5a62322" },
  open_d: { bg: "#001420", accent: "#29b6f6", glow: "#29b6f622" },
  open_e: { bg: "#130a1a", accent: "#ce93d8", glow: "#ce93d822" },
  open_a: { bg: "#001a00", accent: "#66bb6a", glow: "#66bb6a22" },
  dadgad: { bg: "#1a0d00", accent: "#ffa726", glow: "#ffa72622" },
  half_step: { bg: "#0a0a0a", accent: "#b0bec5", glow: "#b0bec522" },
  full_step: { bg: "#001a1a", accent: "#26c6da", glow: "#26c6da22" },
  drop_c: { bg: "#1a0000", accent: "#ef5350", glow: "#ef535022" },
  open_c: { bg: "#001a08", accent: "#4db6ac", glow: "#4db6ac22" },
  double_drop_d: { bg: "#00001a", accent: "#5c6bc0", glow: "#5c6bc022" },
};
function genRandom(n) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(n); crypto.getRandomValues(arr);
  return Array.from(arr).map(x => chars[x % chars.length]).join("");
}
async function genChallenge(v) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function initiateLogin(clientId) {
  const v = genRandom(128), c = await genChallenge(v);
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
async function spFetch(ep, token) {
  const r = await fetch("https://api.spotify.com/v1" + ep, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function getAllPlaylists(token) {
  let all = [], url = "/me/playlists?limit=50";
  while (url) { const d = await spFetch(url, token); all = [...all, ...d.items]; url = d.next ? d.next.replace("https://api.spotify.com/v1","") : null; }
  return all;
}
async function getPlaylistTracks(id, token) {
  let all = [], url = "/playlists/" + id + "/tracks?limit=100";
  while (url) { const d = await spFetch(url, token); all = [...all, ...(d.items||[]).filter(i=>i.track&&i.track.id).map(i=>i.track)]; url = d.next ? d.next.replace("https://api.spotify.com/v1","") : null; }
  return all;
}
async function aiChordChart(title, artist) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500,
      messages: [{ role: "user", content: 'Provide a chord chart for "' + title + '" by ' + artist + '. Return ONLY raw JSON no markdown: {"key":"G","tempo":"120 BPM","capo":"","chords":["G","Em","C","D"],"structure":[{"section":"Verse","chords":"G - Em - C - D"}],"lyrics":[{"section":"Verse 1","lines":[{"text":"lyric line","chords":"G        Em"}]}]}' }] })
  });
  const d = await r.json();
  const raw = (d.content||[]).map(b=>b.text||"").join("") || "{}";
  try { return JSON.parse(raw.replace(/```json|```/g,"").trim()); } catch(e) { return null; }
}
async function aiTuningTips(title, artist, tuningName, tuningNotes) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800,
      messages: [{ role: "user", content: 'Guitar expert advice for playing "' + title + '" by ' + artist + ' in ' + tuningName + ' tuning (' + tuningNotes + '). Cover: original tuning, whether ' + tuningName + ' works, chord shapes, capo, 2-3 live tips. Be concise.' }] })
  });
  const d = await r.json();
  return (d.content||[]).map(b=>b.text||"").join("\n") || "Could not load.";
}

function App() {
  const [clientId, setClientId] = React.useState(localStorage.getItem("ts_cid") || "");
  const [token, setToken] = React.useState(localStorage.getItem("ts_token") || "");
  const [refreshTok, setRefreshTok] = React.useState(localStorage.getItem("ts_refresh") || "");
  const [expiry, setExpiry] = React.useState(parseInt(localStorage.getItem("ts_expiry") || "0"));
  const [profile, setProfile] = React.useState(null);
  const [view, setView] = React.useState("setup");
  const [playlists, setPlaylists] = React.useState([]);
  const [loadingPL, setLoadingPL] = React.useState(false);
  const [tuning, setTuning] = React.useState(null);
  const [playlist, setPlaylist] = React.useState(null);
  const [tracks, setTracks] = React.useState([]);
  const [loadingTracks, setLoadingTracks] = React.useState(false);
  const [song, setSong] = React.useState(null);
  const [songData, setSongData] = React.useState(null);
  const [tips, setTips] = React.useState(null);
  const [loadingSong, setLoadingSong] = React.useState(false);
  const [loadingTips, setLoadingTips] = React.useState(false);
  const [showChords, setShowChords] = React.useState(true);
  const [fontSize, setFontSize] = React.useState(16);

  const C = tuning ? TC[tuning.id] : TC.standard;

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
      if (d && d.access_token) { const exp = Date.now() + d.expires_in * 1000; saveToken(d.access_token, d.refresh_token || refreshTok, exp); return d.access_token; }
    }
    return token;
  }, [token, refreshTok, expiry, clientId]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const cid = localStorage.getItem("ts_cid");
    if (code && cid) {
      window.history.replaceState({}, "", window.location.pathname);
      exchangeCode(code, cid).then(d => { if (d.access_token) saveToken(d.access_token, d.refresh_token, Date.now() + d.expires_in * 1000); });
    }
  }, []);

  React.useEffect(() => {
    if (!token) return;
    getToken().then(t => {
      spFetch("/me", t).then(p => { setProfile(p); setView("tuning"); }).catch(() => {});
      setLoadingPL(true);
      getAllPlaylists(t).then(pls => { setPlaylists(pls); setLoadingPL(false); }).catch(() => setLoadingPL(false));
    });
  }, [token]);

  const handleLogin = () => { if (!clientId.trim()) return; localStorage.setItem("ts_cid", clientId.trim()); initiateLogin(clientId.trim()); };
  const handleLogout = () => { setToken(""); setRefreshTok(""); setProfile(null); setPlaylists([]); ["ts_token","ts_refresh","ts_expiry"].forEach(k => localStorage.removeItem(k)); setView("setup"); };
  const handlePlaylist = async (pl) => { setPlaylist(pl); setLoadingTracks(true); setView("songs"); const t = await getToken(); getPlaylistTracks(pl.id, t).then(tr => { setTracks(tr); setLoadingTracks(false); }).catch(() => setLoadingTracks(false)); };
  const handleSong = async (track) => { setSong(track); setSongData(null); setTips(null); setView("song"); setLoadingSong(true); const d = await aiChordChart(track.name, track.artists.map(a => a.name).join(", ")).catch(() => null); setSongData(d); setLoadingSong(false); };
  const handleTips = async () => { if (loadingTips || tips) return; setLoadingTips(true); const t = await aiTuningTips(song.name, song.artists.map(a=>a.name).join(", "), tuning.name, tuning.notes).catch(() => "Could not load."); setTips(t); setLoadingTips(false); };

  const page = { minHeight: "100vh", background: "radial-gradient(ellipse at top, " + C.glow + " 0%, transparent 50%), linear-gradient(180deg, " + C.bg + " 0%, #030305 100%)", fontFamily: "Georgia, serif", color: "#fff" };
  const hdr = { position: "sticky", top: 0, zIndex: 30, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid " + C.accent + "22", padding: "12px 18px", display: "flex", alignItems: "center", gap: 12 };
  const BackBtn = ({ to }) => React.createElement("button", { onClick: () => setView(to), style: { background: "none", border: "1px solid " + C.accent + "55", color: C.accent, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontFamily: "Georgia, serif" } }, "\u2190 Back");

  if (view === "setup" || !token) return React.createElement("div", { style: { minHeight: "100vh", background: "linear-gradient(160deg,#050508,#0a0d14,#050508)", fontFamily: "Georgia,serif", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px 60px" } },
    React.createElement("div", { style: { textAlign: "center", marginBottom: 36 } },
      React.createElement("div", { style: { fontSize: 52 } }, "\uD83C\uDFB8"),
      React.createElement("h1", { style: { margin: "10px 0 0", fontSize: "clamp(32px,9vw,52px)", fontWeight: 900, background: "linear-gradient(135deg,#1DB954,#a8edbe,#fff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: -1 } }, "TuneSet"),
      React.createElement("p", { style: { color: "#555", fontSize: 14, marginTop: 8, fontStyle: "italic" } }, "Your Spotify songs \u00B7 organized by guitar tuning")
    ),
    React.createElement("div", { style: { width: "100%", maxWidth: 500, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, padding: "28px 24px" } },
      React.createElement("div", { style: { fontSize: 12, color: "#1DB954", letterSpacing: 3, textTransform: "uppercase", marginBottom: 22 } }, "Connect to Spotify"),
      React.createElement("div", { style: { marginBottom: 20 } },
        React.createElement("p", { style: { fontSize: 13, color: "#888", lineHeight: 1.65, marginBottom: 8 } }, "1. Go to ", React.createElement("a", { href: "https://developer.spotify.com/dashboard", target: "_blank", rel: "noreferrer", style: { color: "#1DB954" } }, "developer.spotify.com/dashboard"), ", create an app, add this Redirect URI:"),
        React.createElement("div", { style: { background: "#000", border: "1px solid #1DB95444", borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "#1DB954", wordBreak: "break-all", userSelect: "all", marginBottom: 8 } }, getRedirectUri()),
        React.createElement("p", { style: { fontSize: 13, color: "#888", lineHeight: 1.65, marginBottom: 12 } }, "Set APIs used \u2192 Web API. Save. Then paste your Client ID:"),
        React.createElement("input", { type: "text", placeholder: "Paste Client ID here", value: clientId, onChange: e => setClientId(e.target.value), style: { width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.06)", border: "1px solid " + (clientId ? "#1DB954" : "rgba(255,255,255,0.15)"), borderRadius: 10, color: "#fff", fontSize: 13, fontFamily: "monospace", outline: "none" } }),
        React.createElement("button", { onClick: handleLogin, disabled: !clientId.trim(), style: { width: "100%", padding: 14, marginTop: 14, background: clientId ? "#1DB954" : "#1a1a1a", color: clientId ? "#000" : "#444", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: clientId ? "pointer" : "not-allowed", fontFamily: "Georgia,serif" } }, "\u266A Connect to Spotify")
      ),
      React.createElement("div", { style: { borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14, fontSize: 12, color: "#444", lineHeight: 1.6 } }, "\uD83D\uDD12 PKCE OAuth \u2014 no server, no secret key. Token stays in your browser only.")
    )
  );

  if (view === "tuning") return React.createElement("div", { style: page },
    React.createElement("div", { style: { ...hdr, justifyContent: "space-between" } },
      React.createElement("div", null, React.createElement("div", { style: { fontSize: 20, fontWeight: 900 } }, "\uD83C\uDFB8 TuneSet"), profile && React.createElement("div", { style: { fontSize: 12, color: "#777" } }, profile.display_name)),
      React.createElement("button", { onClick: handleLogout, style: { background: "none", border: "1px solid #2a2a2a", color: "#555", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 } }, "Sign out")
    ),
    React.createElement("div", { style: { padding: "18px 18px 8px" } },
      React.createElement("div", { style: { fontSize: 18, fontWeight: 700, marginBottom: 4 } }, "Choose Your Tuning"),
      React.createElement("div", { style: { fontSize: 13, color: "#666" } }, "Claude AI generates chord charts in your selected tuning")
    ),
    React.createElement("div", { style: { padding: "10px 16px 50px", maxWidth: 640, margin: "0 auto" } },
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
        TUNINGS.map(t => {
          const c = TC[t.id];
          return React.createElement("button", { key: t.id, onClick: () => { setTuning(t); setView("playlist"); }, style: { background: c.bg, border: "1px solid " + c.accent + "30", borderRadius: 14, padding: "16px 13px", cursor: "pointer", textAlign: "left" },
            onMouseEnter: e => { e.currentTarget.style.borderColor = c.accent; }, onMouseLeave: e => { e.currentTarget.style.borderColor = c.accent + "30"; } },
            React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 5 } }, t.name),
            React.createElement("div", { style: { fontSize: 10, fontFamily: "monospace", letterSpacing: 1.5, color: c.accent, textTransform: "uppercase" } }, t.notes)
          );
        })
      )
    )
  );

  if (view === "playlist") return React.createElement("div", { style: page },
    React.createElement("div", { style: hdr }, React.createElement(BackBtn, { to: "tuning" }),
      React.createElement("div", { style: { flex: 1 } }, React.createElement("div", { style: { fontSize: 11, color: C.accent, letterSpacing: 3, textTransform: "uppercase" } }, "Tuning"), React.createElement("div", { style: { fontSize: 17, fontWeight: 700 } }, tuning && tuning.name), React.createElement("div", { style: { fontSize: 10, color: "#555", fontFamily: "monospace" } }, tuning && tuning.notes))
    ),
    React.createElement("div", { style: { padding: "16px 18px 8px" } }, React.createElement("div", { style: { fontSize: 18, fontWeight: 700 } }, "Choose a Playlist")),
    loadingPL ? React.createElement("div", { style: { textAlign: "center", padding: 60, color: "#555" } }, "Loading playlists...") :
    React.createElement("div", { style: { padding: "8px 16px 50px" } },
      playlists.map(pl => React.createElement("button", { key: pl.id, onClick: () => handlePlaylist(pl), style: { width: "100%", display: "flex", alignItems: "center", gap: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer", textAlign: "left" },
        onMouseEnter: e => { e.currentTarget.style.background = C.accent + "12"; }, onMouseLeave: e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; } },
        pl.images && pl.images[0] ? React.createElement("img", { src: pl.images[0].url, alt: "", style: { width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 } }) : React.createElement("div", { style: { width: 48, height: 48, borderRadius: 8, background: C.accent + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 } }, "\u266A"),
        React.createElement("div", { style: { flex: 1, minWidth: 0 } }, React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 } }, pl.name), React.createElement("div", { style: { fontSize: 12, color: "#555" } }, pl.tracks && pl.tracks.total, " tracks")),
        React.createElement("div", { style: { color: "#444", fontSize: 20 } }, "\u203A")
      ))
    )
  );

  if (view === "songs") return React.createElement("div", { style: page },
    React.createElement("div", { style: hdr }, React.createElement(BackBtn, { to: "playlist" }),
      React.createElement("div", { style: { flex: 1, minWidth: 0 } }, React.createElement("div", { style: { fontSize: 11, color: C.accent, letterSpacing: 2, textTransform: "uppercase" } }, tuning && tuning.name), React.createElement("div", { style: { fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, playlist && playlist.name)),
      React.createElement("div", { style: { fontSize: 11, color: C.accent, background: C.accent + "15", border: "1px solid " + C.accent + "33", borderRadius: 8, padding: "4px 10px", flexShrink: 0 } }, tracks.length)
    ),
    loadingTracks ? React.createElement("div", { style: { textAlign: "center", padding: 60, color: "#555" } }, "Loading tracks...") :
    React.createElement("div", { style: { padding: "8px 16px 50px" } },
      React.createElement("div", { style: { background: C.accent + "0d", border: "1px solid " + C.accent + "22", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#777", lineHeight: 1.5 } }, "\u2726 Tap a song \u2014 Claude AI generates chords & lyrics for ", React.createElement("strong", { style: { color: C.accent } }, tuning && tuning.name), " tuning"),
      tracks.map((track, i) => React.createElement("button", { key: track.id || i, onClick: () => handleSong(track), style: { width: "100%", display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "11px 12px", marginBottom: 7, cursor: "pointer", textAlign: "left" },
        onMouseEnter: e => { e.currentTarget.style.background = C.accent + "10"; }, onMouseLeave: e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; } },
        track.album && track.album.images && track.album.images[0] ? React.createElement("img", { src: track.album.images[0].url, alt: "", style: { width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 } }) : React.createElement("div", { style: { width: 44, height: 44, borderRadius: 6, background: C.accent + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 } }, "\u266B"),
        React.createElement("div", { style: { flex: 1, minWidth: 0 } }, React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 } }, track.name), React.createElement("div", { style: { fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, track.artists.map(a => a.name).join(", "))),
        React.createElement("div", { style: { color: "#444", fontSize: 18 } }, "\u203A")
      ))
    )
  );

  if (view === "song" && song) {
    const artist = song.artists.map(a => a.name).join(", ");
    return React.createElement("div", { style: page },
      React.createElement("div", { style: hdr }, React.createElement(BackBtn, { to: "songs" }),
        React.createElement("div", { style: { flex: 1, minWidth: 0 } }, React.createElement("div", { style: { fontSize: 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, song.name), React.createElement("div", { style: { fontSize: 12, color: "#777" } }, artist))
      ),
      React.createElement("div", { style: { position: "sticky", top: 57, zIndex: 25, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: "1px solid " + C.accent + "15", padding: "9px 16px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
        React.createElement("button", { onClick: () => setShowChords(!showChords), style: { padding: "7px 13px", borderRadius: 10, fontSize: 12, cursor: "pointer", background: showChords ? C.accent : "rgba(255,255,255,0.05)", color: showChords ? "#000" : C.accent, border: "1px solid " + C.accent + "55", fontWeight: 700, fontFamily: "Georgia,serif" } }, showChords ? "Chords \u2713" : "Chords"),
        React.createElement("button", { onClick: () => setFontSize(f => Math.max(12, f-2)), style: { padding: "7px 11px", borderRadius: 10, fontSize: 13, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#aaa", border: "1px solid rgba(255,255,255,0.1)" } }, "A\u2212"),
        React.createElement("button", { onClick: () => setFontSize(f => Math.min(28, f+2)), style: { padding: "7px 11px", borderRadius: 10, fontSize: 13, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#aaa", border: "1px solid rgba(255,255,255,0.1)" } }, "A+"),
        React.createElement("button", { onClick: handleTips, disabled: loadingTips || !!tips, style: { padding: "7px 13px", borderRadius: 10, fontSize: 12, cursor: (loadingTips||tips) ? "default" : "pointer", background: tips ? C.accent + "18" : "rgba(255,255,255,0.05)", color: C.accent, border: "1px solid " + C.accent + "44", marginLeft: "auto", fontFamily: "Georgia,serif" } }, loadingTips ? "\u2726 Loading..." : tips ? "\u2726 Tips \u2713" : "\u2726 Tuning Tips")
      ),
      React.createElement("div", { style: { paddingBottom: 60 } },
        song.album && song.album.images && song.album.images[0] && React.createElement("div", { style: { padding: "14px 16px 0", display: "flex", gap: 14, alignItems: "center" } }, React.createElement("img", { src: song.album.images[0].url, alt: "", style: { width: 60, height: 60, borderRadius: 10, objectFit: "cover" } }), React.createElement("div", null, React.createElement("div", { style: { fontSize: 13, color: "#666" } }, song.album.name), React.createElement("div", { style: { fontSize: 11, color: C.accent, marginTop: 4, fontFamily: "monospace", letterSpacing: 1.5 } }, tuning && tuning.name, " \u00B7 ", tuning && tuning.notes))),
        loadingSong && React.createElement("div", { style: { textAlign: "center", padding: "50px 20px", color: "#555" } }, React.createElement("div", { style: { fontSize: 14, marginBottom: 6 } }, "\u2726 Claude is generating the chord chart..."), React.createElement("div", { style: { fontSize: 12, color: "#444" } }, "Adapted for ", tuning && tuning.name, " tuning")),
        tips && React.createElement("div", { style: { margin: "14px 16px 0", background: C.accent + "0a", border: "1px solid " + C.accent + "28", borderRadius: 12, padding: 16 } }, React.createElement("div", { style: { fontSize: 11, color: C.accent, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 } }, "\u2726 AI Tuning Analysis"), React.createElement("div", { style: { fontSize: 13, color: "#ccc", lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "monospace" } }, tips)),
        !loadingSong && songData && React.createElement(React.Fragment, null,
          React.createElement("div", { style: { padding: "14px 16px 0" } },
            React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 } },
              songData.key && React.createElement("div", { style: { background: C.accent + "18", border: "1px solid " + C.accent + "44", borderRadius: 8, padding: "5px 13px", fontSize: 13, color: C.accent, fontWeight: 700 } }, "Key: ", songData.key),
              songData.tempo && React.createElement("div", { style: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 13px", fontSize: 13, color: "#888" } }, songData.tempo),
              songData.capo && React.createElement("div", { style: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 13px", fontSize: 13, color: "#888" } }, "Capo ", songData.capo)
            ),
            songData.chords && songData.chords.length > 0 && React.createElement("div", { style: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 } }, songData.chords.map((ch, i) => React.createElement("div", { key: i, style: { flexShrink: 0, background: C.accent + "10", border: "1px solid " + C.accent + "33", borderRadius: 8, padding: "5px 12px", fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: "monospace" } }, ch))),
            songData.structure && songData.structure.length > 0 && React.createElement("div", { style: { background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 14px", marginBottom: 4 } }, React.createElement("div", { style: { fontSize: 11, color: C.accent, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 } }, "Song Structure"), songData.structure.map((s, i) => React.createElement("div", { key: i, style: { marginBottom: 6, display: "flex", gap: 10, alignItems: "baseline" } }, React.createElement("span", { style: { fontSize: 11, color: C.accent, fontFamily: "monospace", minWidth: 60, flexShrink: 0 } }, s.section), React.createElement("span", { style: { fontSize: 13, color: "#aaa", fontFamily: "monospace" } }, s.chords))))
          ),
          songData.lyrics && songData.lyrics.length > 0 && React.createElement("div", { style: { padding: "10px 16px", display: "flex", gap: 7, overflowX: "auto" } }, songData.lyrics.map((sec, i) => React.createElement("button", { key: i, onClick: () => { const el = document.getElementById("s"+i); if(el) el.scrollIntoView({behavior:"smooth"}); }, style: { padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#777", border: "1px solid rgba(255,255,255,0.1)", whiteSpace: "nowrap", flexShrink: 0, fontFamily: "Georgia,serif" } }, sec.section))),
          songData.lyrics && songData.lyrics.map((section, si) => React.createElement("div", { key: si, id: "s"+si, style: { padding: "14px 20px" } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } }, React.createElement("div", { style: { fontSize: 11, fontWeight: 800, color: C.accent, letterSpacing: 3, textTransform: "uppercase" } }, section.section), React.createElement("div", { style: { flex: 1, height: 1, background: C.accent + "20" } })),
            section.lines && section.lines.map((line, li) => React.createElement("div", { key: li, style: { marginBottom: showChords ? 10 : 3 } },
              showChords && line.chords && React.createElement("div", { style: { fontSize: 12, color: C.accent, fontFamily: "'Courier New',monospace", letterSpacing: 0.5, whiteSpace: "pre", marginBottom: 2, opacity: 0.9 } }, line.chords),
              React.createElement("div", { style: { fontSize: fontSize, color: "#ede9e0", lineHeight: 1.5 } }, line.text)
            ))
          ))
        ),
        !loadingSong && !songData && React.createElement("div", { style: { textAlign: "center", padding: "40px 20px", color: "#555" } }, "Could not generate chart. Tap \u2726 Tuning Tips for help.")
      )
    );
  }

  return null;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(React.StrictMode, null, React.createElement(App, null)));
