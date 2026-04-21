import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// Set your Spotify Client ID here OR the app will prompt for it on first run.
// Your GitHub Pages URL will be:  https://YOUR-USERNAME.github.io/tuneset
// Add that exact URL as a Redirect URI in your Spotify Developer Dashboard.
// ─────────────────────────────────────────────────────────────────────────────
const HARDCODED_CLIENT_ID = ""; // optional: paste your Client ID here to skip the setup screen
const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read";

function getRedirectUri() {
  // In production (GitHub Pages), use the actual page URL
  return window.location.origin + window.location.pathname;
}

// ─────────────────────────────────────────────────────────────────────────────
// TUNING DATA
// ─────────────────────────────────────────────────────────────────────────────
const TUNINGS = [
  { id: "standard",      name: "Standard",        notes: "E A D G B E" },
  { id: "drop_d",        name: "Drop D",           notes: "D A D G B E" },
  { id: "open_g",        name: "Open G",           notes: "D G D G B D" },
  { id: "open_d",        name: "Open D",           notes: "D A D F# A D" },
  { id: "open_e",        name: "Open E",           notes: "E B E G# B E" },
  { id: "open_a",        name: "Open A",           notes: "E A E A C# E" },
  { id: "dadgad",        name: "DADGAD",           notes: "D A D G A D" },
  { id: "half_step",     name: "Half Step Down",   notes: "Eb Ab Db Gb Bb Eb" },
  { id: "full_step",     name: "Full Step Down",   notes: "D G C F A D" },
  { id: "drop_c",        name: "Drop C",           notes: "C G C F A D" },
  { id: "open_c",        name: "Open C",           notes: "C G C G C E" },
  { id: "double_drop_d", name: "Double Drop D",    notes: "D A D G B D" },
];

const TUNING_COLORS = {
  standard:      { bg: "#0d1117", accent: "#1DB954", glow: "#1DB95422" },
  drop_d:        { bg: "#0f0f1a", accent: "#e94560", glow: "#e9456022" },
  open_g:        { bg: "#140f00", accent: "#f5a623", glow: "#f5a62322" },
  open_d:        { bg: "#001420", accent: "#29b6f6", glow: "#29b6f622" },
  open_e:        { bg: "#130a1a", accent: "#ce93d8", glow: "#ce93d822" },
  open_a:        { bg: "#001a00", accent: "#66bb6a", glow: "#66bb6a22" },
  dadgad:        { bg: "#1a0d00", accent: "#ffa726", glow: "#ffa72622" },
  half_step:     { bg: "#0a0a0a", accent: "#b0bec5", glow: "#b0bec522" },
  full_step:     { bg: "#001a1a", accent: "#26c6da", glow: "#26c6da22" },
  drop_c:        { bg: "#1a0000", accent: "#ef5350", glow: "#ef535022" },
  open_c:        { bg: "#001a08", accent: "#4db6ac", glow: "#4db6ac22" },
  double_drop_d: { bg: "#00001a", accent: "#5c6bc0", glow: "#5c6bc022" },
};

// ─────────────────────────────────────────────────────────────────────────────
// PKCE OAUTH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(x => chars[x % chars.length]).join("");
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function initiateLogin(clientId) {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("sp_verifier", verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCode(code, clientId) {
  const verifier = sessionStorage.getItem("sp_verifier");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    }),
  });
  return res.json();
}

async function doRefresh(refreshToken, clientId) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// SPOTIFY API
// ─────────────────────────────────────────────────────────────────────────────
async function spFetch(endpoint, token) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function getAllPlaylists(token) {
  let all = [], url = "/me/playlists?limit=50";
  while (url) {
    const d = await spFetch(url, token);
    all = [...all, ...d.items];
    url = d.next ? d.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return all;
}

async function getPlaylistTracks(id, token) {
  let all = [], url = `/playlists/${id}/tracks?limit=100&fields=next,items(track(id,name,artists,album(name,images)))`;
  while (url) {
    const d = await spFetch(url, token);
    const valid = (d.items || []).filter(i => i.track?.id).map(i => i.track);
    all = [...all, ...valid];
    url = d.next ? d.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE AI HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function aiChordChart(title, artist) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Provide a chord chart for "${title}" by ${artist}. Return ONLY a raw JSON object, no markdown, no backticks:
{
  "key": "G",
  "tempo": "120 BPM",
  "capo": "",
  "chords": ["G","Em","C","D"],
  "structure": [
    {"section": "Verse", "chords": "G - Em - C - D"}
  ],
  "lyrics": [
    {
      "section": "Verse 1",
      "lines": [
        {"text": "lyric line here", "chords": "G        Em"},
        {"text": "next lyric line", "chords": "C         D"}
      ]
    }
  ]
}
Include intro (if notable), 2 verses minimum, chorus, bridge if applicable. Use real chord names aligned above lyrics text. Return ONLY the JSON.`
      }]
    })
  });
  const data = await res.json();
  const raw = data.content?.map(b => b.text || "").join("") || "{}";
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return null; }
}

async function aiTuningTips(title, artist, tuningName, tuningNotes) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `Guitar expert advice for playing "${title}" by ${artist} in ${tuningName} tuning (${tuningNotes}).
Cover:
1. Original tuning used on the recording
2. Whether ${tuningName} works well — if not, best alternative
3. Chord shapes specific to ${tuningName} tuning
4. Capo recommendation if helpful
5. 2-3 live performance tips

Be concise and practical.`
      }]
    })
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("\n") || "Could not load.";
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // Auth state
  const [clientId, setClientId] = useState(
    HARDCODED_CLIENT_ID || localStorage.getItem("ts_client_id") || ""
  );
  const [token, setToken]           = useState(localStorage.getItem("ts_token") || "");
  const [refreshTok, setRefreshTok] = useState(localStorage.getItem("ts_refresh") || "");
  const [expiry, setExpiry]         = useState(parseInt(localStorage.getItem("ts_expiry") || "0"));
  const [profile, setProfile]       = useState(null);

  // App state
  const [view, setView] = useState("setup");
  const [playlists, setPlaylists]           = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [selectedTuning, setSelectedTuning] = useState(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [tracks, setTracks]                 = useState([]);
  const [loadingTracks, setLoadingTracks]   = useState(false);
  const [selectedSong, setSelectedSong]     = useState(null);
  const [songData, setSongData]             = useState(null);
  const [tuningTips, setTuningTips]         = useState(null);
  const [loadingSong, setLoadingSong]       = useState(false);
  const [loadingTips, setLoadingTips]       = useState(false);
  const [showChords, setShowChords]         = useState(true);
  const [fontSize, setFontSize]             = useState(16);

  const C = selectedTuning ? TUNING_COLORS[selectedTuning.id] : TUNING_COLORS.standard;

  // ── Token management ───────────────────────────────────────────────────────
  const saveToken = (t, r, exp) => {
    setToken(t); setRefreshTok(r); setExpiry(exp);
    localStorage.setItem("ts_token", t);
    if (r) localStorage.setItem("ts_refresh", r);
    localStorage.setItem("ts_expiry", String(exp));
  };

  const getToken = useCallback(async () => {
    if (Date.now() < expiry - 60000) return token;
    if (refreshTok && clientId) {
      const d = await doRefresh(refreshTok, clientId).catch(() => null);
      if (d?.access_token) {
        const exp = Date.now() + d.expires_in * 1000;
        saveToken(d.access_token, d.refresh_token || refreshTok, exp);
        return d.access_token;
      }
    }
    return token;
  }, [token, refreshTok, expiry, clientId]);

  // ── Handle OAuth callback ──────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const storedId = localStorage.getItem("ts_client_id");
    if (code && storedId) {
      window.history.replaceState({}, "", window.location.pathname);
      exchangeCode(code, storedId).then(d => {
        if (d.access_token) {
          saveToken(d.access_token, d.refresh_token, Date.now() + d.expires_in * 1000);
        }
      });
    }
  }, []);

  // ── Load profile + playlists when token ready ──────────────────────────────
  useEffect(() => {
    if (!token) return;
    getToken().then(t => {
      spFetch("/me", t).then(p => { setProfile(p); setView("tuning"); }).catch(() => {});
      setLoadingPlaylists(true);
      getAllPlaylists(t).then(pls => { setPlaylists(pls); setLoadingPlaylists(false); })
        .catch(() => setLoadingPlaylists(false));
    });
  }, [token]);

  const handleLogin = () => {
    if (!clientId.trim()) return;
    localStorage.setItem("ts_client_id", clientId.trim());
    initiateLogin(clientId.trim());
  };

  const handleLogout = () => {
    setToken(""); setRefreshTok(""); setProfile(null); setPlaylists([]);
    ["ts_token","ts_refresh","ts_expiry"].forEach(k => localStorage.removeItem(k));
    setView("setup");
  };

const handlePlaylist = async (pl) => { setPlaylist(pl); setLoadingTracks(true); setView("songs"); try { const t = await getToken(); const url = "/playlists/" + pl.id + "/tracks?limit=10"; const r = await fetch("https://api.spotify.com/v1" + url, { headers: { Authorization: "Bearer " + t } }); const d = await r.json(); alert("Status: " + r.status + "\nResponse: " + JSON.stringify(d).substring(0, 300)); const valid = (d.items||[]).filter(i=>i.track&&i.track.id).map(i=>i.track); setTracks(valid); } catch(e) { alert("Error: " + e.message); } setLoadingTracks(false); };

  const handleSongSelect = async (track) => {
    setSelectedSong(track);
    setSongData(null);
    setTuningTips(null);
    setView("song");
    setLoadingSong(true);
    const data = await aiChordChart(track.name, track.artists.map(a => a.name).join(", ")).catch(() => null);
    setSongData(data);
    setLoadingSong(false);
  };

  const handleTips = async () => {
    if (!selectedSong || loadingTips || tuningTips) return;
    setLoadingTips(true);
    const artist = selectedSong.artists.map(a => a.name).join(", ");
    const tips = await aiTuningTips(selectedSong.name, artist, selectedTuning?.name, selectedTuning?.notes).catch(() => "Could not load.");
    setTuningTips(tips);
    setLoadingTips(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SHARED UI HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  const pageStyle = {
    minHeight: "100vh",
    background: `radial-gradient(ellipse at top, ${C.glow} 0%, transparent 50%), linear-gradient(180deg, ${C.bg} 0%, #030305 100%)`,
    fontFamily: "'Georgia', 'Times New Roman', serif",
    color: "#fff",
  };

  const stickyHeader = {
    position: "sticky", top: 0, zIndex: 30,
    background: "rgba(0,0,0,0.75)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderBottom: `1px solid ${C.accent}22`,
    padding: "12px 18px",
    display: "flex", alignItems: "center", gap: 12,
  };

  const BackBtn = ({ to }) => (
    <button onClick={() => setView(to)} style={{
      background: "none", border: `1px solid ${C.accent}55`,
      color: C.accent, padding: "8px 14px", borderRadius: 10,
      cursor: "pointer", fontSize: 14, flexShrink: 0,
      fontFamily: "Georgia, serif",
    }}>← Back</button>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: SETUP
  // ─────────────────────────────────────────────────────────────────────────
  if (view === "setup" || !token) {
    const redirectUri = getRedirectUri();
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #050508 0%, #0a0d14 60%, #050508 100%)",
        fontFamily: "Georgia, serif", color: "#fff",
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "40px 20px 60px",
      }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>🎸</div>
          <h1 style={{
            margin: 0, fontSize: "clamp(34px, 9vw, 56px)", fontWeight: 900,
            background: "linear-gradient(135deg, #1DB954, #a8edbe, #fff)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            letterSpacing: -1,
          }}>TuneSet</h1>
          <p style={{ color: "#555", fontSize: 14, marginTop: 8, fontStyle: "italic" }}>
            Your Spotify songs · organized by guitar tuning
          </p>
        </div>

        <div style={{
          width: "100%", maxWidth: 500,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20, padding: "28px 24px",
        }}>
          <div style={{ fontSize: 12, color: "#1DB954", letterSpacing: 3, textTransform: "uppercase", marginBottom: 22 }}>
            Connect to Spotify
          </div>

          {/* Step 1 */}
          <Step num={1} title="Register a free Spotify Developer App">
            <p style={stepText}>
              Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color: "#1DB954" }}>developer.spotify.com/dashboard</a>, sign in, click <b style={{ color: "#fff" }}>Create App</b>.
            </p>
            <p style={stepText}>Name it anything (e.g. <i>TuneSet</i>). Under <b style={{ color: "#fff" }}>Redirect URIs</b> add this exact URL:</p>
            <div style={{
              background: "#000", border: "1px solid #1DB95455",
              borderRadius: 8, padding: "10px 14px", margin: "8px 0",
              fontFamily: "monospace", fontSize: 12, color: "#1DB954",
              wordBreak: "break-all", userSelect: "all",
            }}>
              {redirectUri}
            </div>
            <p style={stepText}>Set <b style={{ color: "#fff" }}>APIs used</b> → Web API. Save.</p>
          </Step>

          {/* Step 2 */}
          <Step num={2} title="Paste your Client ID">
            <p style={stepText}>From your app's dashboard, copy the <b style={{ color: "#fff" }}>Client ID</b>:</p>
            <input
              type="text"
              placeholder="e.g. 4b72c3d1e89a4f2b8c1d5e6f7a8b9c0d"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              style={{
                width: "100%", padding: "12px 14px",
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${clientId ? "#1DB954" : "rgba(255,255,255,0.15)"}`,
                borderRadius: 10, color: "#fff",
                fontSize: 13, fontFamily: "monospace",
                outline: "none", marginTop: 8,
              }}
            />
          </Step>

          {/* Step 3 */}
          <Step num={3} title="Connect" accent={clientId ? "#1DB954" : undefined}>
            <button
              onClick={handleLogin}
              disabled={!clientId.trim()}
              style={{
                width: "100%", padding: "14px",
                background: clientId ? "#1DB954" : "#1a1a1a",
                color: clientId ? "#000" : "#444",
                border: "none", borderRadius: 12,
                fontSize: 15, fontWeight: 800,
                cursor: clientId ? "pointer" : "not-allowed",
                fontFamily: "Georgia, serif", transition: "opacity 0.2s",
              }}
            >
              ♪ Connect to Spotify
            </button>
          </Step>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14, fontSize: 12, color: "#444", lineHeight: 1.6, marginTop: 8 }}>
            🔒 Uses PKCE OAuth — no secret key, no server. Your Spotify token stays in your browser only.
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: TUNING
  // ─────────────────────────────────────────────────────────────────────────
  if (view === "tuning") {
    return (
      <div style={pageStyle}>
        <div style={{ ...stickyHeader, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.5 }}>🎸 TuneSet</div>
            {profile && <div style={{ fontSize: 12, color: "#777" }}>{profile.display_name}</div>}
          </div>
          <button onClick={handleLogout} style={{ background: "none", border: "1px solid #2a2a2a", color: "#555", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
            Sign out
          </button>
        </div>

        <div style={{ padding: "18px 18px 8px" }}>
          <div style={{ fontSize: 12, color: "#555", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>Step 1</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Choose Your Tuning</div>
          <div style={{ fontSize: 13, color: "#666" }}>Claude AI will generate chord charts in your selected tuning</div>
        </div>

        <div style={{ padding: "10px 16px 50px", maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {TUNINGS.map(t => {
              const tc = TUNING_COLORS[t.id];
              return (
                <button key={t.id}
                  onClick={() => { setSelectedTuning(t); setView("playlist"); }}
                  style={{
                    background: tc.bg, border: `1px solid ${tc.accent}30`,
                    borderRadius: 14, padding: "16px 13px",
                    cursor: "pointer", textAlign: "left",
                    transition: "border-color 0.2s, transform 0.15s, box-shadow 0.2s",
                    position: "relative", overflow: "hidden",
                  }}
                  onTouchStart={e => { e.currentTarget.style.opacity = "0.8"; }}
                  onTouchEnd={e => { e.currentTarget.style.opacity = "1"; }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = tc.accent;
                    e.currentTarget.style.transform = "scale(1.02)";
                    e.currentTarget.style.boxShadow = `0 6px 20px ${tc.accent}20`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = `${tc.accent}30`;
                    e.currentTarget.style.transform = "scale(1)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{ position: "absolute", top: -8, right: -8, width: 50, height: 50, background: `radial-gradient(circle, ${tc.accent}15, transparent 70%)`, borderRadius: "50%" }} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 5 }}>{t.name}</div>
                  <div style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 1.5, color: tc.accent, textTransform: "uppercase" }}>{t.notes}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: PLAYLIST
  // ─────────────────────────────────────────────────────────────────────────
  if (view === "playlist") {
    return (
      <div style={pageStyle}>
        <div style={stickyHeader}>
          <BackBtn to="tuning" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.accent, letterSpacing: 3, textTransform: "uppercase" }}>Tuning</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{selectedTuning?.name}</div>
            <div style={{ fontSize: 10, color: "#555", fontFamily: "monospace", letterSpacing: 2 }}>{selectedTuning?.notes}</div>
          </div>
        </div>

        <div style={{ padding: "16px 18px 8px" }}>
          <div style={{ fontSize: 12, color: "#555", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>Step 2</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Choose a Playlist</div>
        </div>

        {loadingPlaylists ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#555" }}>Loading your playlists...</div>
        ) : (
          <div style={{ padding: "8px 16px 50px" }}>
            {playlists.map(pl => (
              <button key={pl.id}
                onClick={() => handlePlaylistSelect(pl)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 14,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 12, padding: "12px 14px", marginBottom: 8,
                  cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}12`; e.currentTarget.style.borderColor = `${C.accent}44`; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
              >
                {pl.images?.[0]?.url
                  ? <img src={pl.images[0].url} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: 8, background: `${C.accent}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>♪</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{pl.name}</div>
                  <div style={{ fontSize: 12, color: "#555" }}>{pl.tracks?.total} tracks</div>
                </div>
                <div style={{ color: "#444", fontSize: 20 }}>›</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: SONGS
  // ─────────────────────────────────────────────────────────────────────────
  if (view === "songs") {
    return (
      <div style={pageStyle}>
        <div style={stickyHeader}>
          <BackBtn to="playlist" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.accent, letterSpacing: 2, textTransform: "uppercase" }}>{selectedTuning?.name}</div>
            <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedPlaylist?.name}</div>
          </div>
          <div style={{ fontSize: 11, color: C.accent, background: `${C.accent}15`, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: "4px 10px", flexShrink: 0 }}>
            {tracks.length}
          </div>
        </div>

        {loadingTracks ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#555" }}>Loading tracks...</div>
        ) : (
          <div style={{ padding: "8px 16px 50px" }}>
            <div style={{ background: `${C.accent}0d`, border: `1px solid ${C.accent}22`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#777", lineHeight: 1.5 }}>
              ✦ Tap a song — Claude AI generates chords & lyrics for <strong style={{ color: C.accent }}>{selectedTuning?.name}</strong> tuning
            </div>
            {tracks.map((track, i) => (
              <button key={track.id || i}
                onClick={() => handleSongSelect(track)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 12, padding: "11px 12px", marginBottom: 7,
                  cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}10`; e.currentTarget.style.borderColor = `${C.accent}33`; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
              >
                {track.album?.images?.[0]?.url
                  ? <img src={track.album.images[0].url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 6, background: `${C.accent}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>♫</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{track.name}</div>
                  <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.artists.map(a => a.name).join(", ")}</div>
                </div>
                <div style={{ color: "#444", fontSize: 18 }}>›</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: SONG
  // ─────────────────────────────────────────────────────────────────────────
  if (view === "song" && selectedSong) {
    const artist = selectedSong.artists.map(a => a.name).join(", ");
    return (
      <div style={pageStyle}>
        {/* Header */}
        <div style={stickyHeader}>
          <BackBtn to="songs" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedSong.name}</div>
            <div style={{ fontSize: 12, color: "#777" }}>{artist}</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{
          position: "sticky", top: 57, zIndex: 25,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderBottom: `1px solid ${C.accent}15`,
          padding: "9px 16px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
        }}>
          <button onClick={() => setShowChords(!showChords)} style={{
            padding: "7px 13px", borderRadius: 10, fontSize: 12, cursor: "pointer",
            background: showChords ? C.accent : "rgba(255,255,255,0.05)",
            color: showChords ? "#000" : C.accent,
            border: `1px solid ${C.accent}55`, fontWeight: 700, fontFamily: "Georgia, serif",
          }}>{showChords ? "Chords ✓" : "Chords"}</button>

          <button onClick={() => setFontSize(f => Math.max(12, f - 2))} style={{ padding: "7px 11px", borderRadius: 10, fontSize: 13, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#aaa", border: "1px solid rgba(255,255,255,0.1)" }}>A−</button>
          <button onClick={() => setFontSize(f => Math.min(28, f + 2))} style={{ padding: "7px 11px", borderRadius: 10, fontSize: 13, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#aaa", border: "1px solid rgba(255,255,255,0.1)" }}>A+</button>

          <button onClick={handleTips} disabled={loadingTips || !!tuningTips} style={{
            padding: "7px 13px", borderRadius: 10, fontSize: 12,
            cursor: (loadingTips || tuningTips) ? "default" : "pointer",
            background: tuningTips ? `${C.accent}18` : "rgba(255,255,255,0.05)",
            color: C.accent, border: `1px solid ${C.accent}44`,
            marginLeft: "auto", fontFamily: "Georgia, serif",
          }}>
            {loadingTips ? "✦ Loading..." : tuningTips ? "✦ Tips ✓" : "✦ Tuning Tips"}
          </button>
        </div>

        <div style={{ paddingBottom: 60 }}>
          {/* Album art */}
          {selectedSong.album?.images?.[0]?.url && (
            <div style={{ padding: "14px 16px 0", display: "flex", gap: 14, alignItems: "center" }}>
              <img src={selectedSong.album.images[0].url} alt="" style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover" }} />
              <div>
                <div style={{ fontSize: 13, color: "#666" }}>{selectedSong.album.name}</div>
                <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontFamily: "monospace", letterSpacing: 1.5 }}>
                  {selectedTuning?.name} · {selectedTuning?.notes}
                </div>
              </div>
            </div>
          )}

          {/* Loading */}
          {loadingSong && (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#555" }}>
              <div style={{ fontSize: 14, marginBottom: 6 }}>✦ Claude is generating the chord chart...</div>
              <div style={{ fontSize: 12, color: "#444" }}>Adapted for {selectedTuning?.name} tuning</div>
            </div>
          )}

          {/* Tuning Tips */}
          {tuningTips && (
            <div style={{ margin: "14px 16px 0", background: `${C.accent}0a`, border: `1px solid ${C.accent}28`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.accent, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>✦ AI Tuning Analysis</div>
              <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{tuningTips}</div>
            </div>
          )}

          {/* Song data */}
          {!loadingSong && songData && (
            <>
              <div style={{ padding: "14px 16px 0" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  {songData.key && <div style={{ background: `${C.accent}18`, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: "5px 13px", fontSize: 13, color: C.accent, fontWeight: 700 }}>Key: {songData.key}</div>}
                  {songData.tempo && <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 13px", fontSize: 13, color: "#888" }}>{songData.tempo}</div>}
                  {songData.capo && <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 13px", fontSize: 13, color: "#888" }}>Capo {songData.capo}</div>}
                </div>

                {/* Chords used */}
                {songData.chords?.length > 0 && (
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
                    {songData.chords.map((ch, i) => (
                      <div key={i} style={{ flexShrink: 0, background: `${C.accent}10`, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: "5px 12px", fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: "monospace" }}>
                        {ch}
                      </div>
                    ))}
                  </div>
                )}

                {/* Structure */}
                {songData.structure?.length > 0 && (
                  <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 14px", marginBottom: 4 }}>
                    <div style={{ fontSize: 11, color: C.accent, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>Song Structure</div>
                    {songData.structure.map((s, i) => (
                      <div key={i} style={{ marginBottom: 6, display: "flex", gap: 10, alignItems: "baseline" }}>
                        <span style={{ fontSize: 11, color: C.accent, fontFamily: "monospace", minWidth: 60, flexShrink: 0 }}>{s.section}</span>
                        <span style={{ fontSize: 13, color: "#aaa", fontFamily: "monospace" }}>{s.chords}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section jump nav */}
              {songData.lyrics?.length > 0 && (
                <div style={{ padding: "10px 16px", display: "flex", gap: 7, overflowX: "auto" }}>
                  {songData.lyrics.map((sec, i) => (
                    <button key={i}
                      onClick={() => document.getElementById(`sec-${i}`)?.scrollIntoView({ behavior: "smooth" })}
                      style={{
                        padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                        background: "rgba(255,255,255,0.05)", color: "#777",
                        border: "1px solid rgba(255,255,255,0.1)", whiteSpace: "nowrap", flexShrink: 0,
                        fontFamily: "Georgia, serif",
                      }}
                    >
                      {sec.section}
                    </button>
                  ))}
                </div>
              )}

              {/* Lyrics */}
              {songData.lyrics?.map((section, si) => (
                <div key={si} id={`sec-${si}`} style={{ padding: "14px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.accent, letterSpacing: 3, textTransform: "uppercase" }}>{section.section}</div>
                    <div style={{ flex: 1, height: 1, background: `${C.accent}20` }} />
                  </div>
                  {section.lines?.map((line, li) => (
                    <div key={li} style={{ marginBottom: showChords ? 10 : 3 }}>
                      {showChords && line.chords && (
                        <div style={{ fontSize: 12, color: C.accent, fontFamily: "'Courier New', monospace", letterSpacing: 0.5, whiteSpace: "pre", marginBottom: 2, opacity: 0.9 }}>
                          {line.chords}
                        </div>
                      )}
                      <div style={{ fontSize, color: "#ede9e0", lineHeight: 1.5 }}>{line.text}</div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          {!loadingSong && !songData && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#555" }}>
              <div>Could not generate chart. Tap ✦ Tuning Tips for help.</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL HELPER COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const stepText = { fontSize: 13, color: "#888", lineHeight: 1.65, margin: "4px 0" };

function Step({ num, title, children, accent = "#1DB954" }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: "50%", background: accent || "#333",
          color: accent ? "#000" : "#666",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 900, flexShrink: 0,
        }}>{num}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{title}</div>
      </div>
      <div style={{ paddingLeft: 36 }}>{children}</div>
    </div>
  );
}
