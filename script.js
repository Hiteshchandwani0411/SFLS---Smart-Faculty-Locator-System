// ─── CONFIG ───────────────────────────────────────
const API = "http://localhost:5000/api";
let leafletMap = null;

// ─── STATE ────────────────────────────────────────
let state = {
  token: localStorage.getItem("sfls_token"),
  user: JSON.parse(localStorage.getItem("sfls_user") || "null"),
  facultyId: null,
  faculties: [],
  currentFaculty: null,
  selectedStatus: null,
  selectedSeat: null,
  searchTimer: null,
  searchStatus: "",
  subscriptions: new Set(JSON.parse(localStorage.getItem("sfls_subs") || "[]")),
  ws: null,
  outdoorDestination: null,
};

// ─── INIT ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  restoreSession();
  loadFaculty();
  connectWebSocket();
  requestNotifPermission();
});

function restoreSession() {
  if (state.user) {
    if (state.user.faculty_id) state.facultyId = state.user.faculty_id;
    showUserNav(state.user);
    if (state.user.role === "faculty") {
      ensureFacultyProfile().then((ok) => {
        if (ok) showFacultyPage();
      });
    } else if (state.user.role === "admin") showAdminPage();
  }
}

function persistUser() {
  if (state.user) localStorage.setItem("sfls_user", JSON.stringify(state.user));
}

function applyAuthPayload(data) {
  state.token = data.token;
  state.user = {
    id: data.id,
    role: data.role,
    name: data.name,
    faculty_id: data.faculty_id ?? null,
    faculty_profile_complete: data.faculty_profile_complete ?? false,
  };
  if (data.faculty_id) state.facultyId = data.faculty_id;
  localStorage.setItem("sfls_token", data.token);
  persistUser();
}

// ─── HTTP HELPER ──────────────────────────────────
async function api(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (state.token) opts.headers["Authorization"] = `Bearer ${state.token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
  return data;
}

// ─── MOCK DATA (for demo without backend) ─────────
function getMockData(path, method, body) {
  if (path === "/faculty" || path.startsWith("/faculty?"))
    return mockFacultyList();
  if (
    path.startsWith("/faculty/") &&
    path.endsWith("/status") &&
    method === "PATCH"
  ) {
    return { success: true, new_status: body?.status };
  }
  if (path.startsWith("/faculty/"))
    return mockFacultyDetail(parseInt(path.split("/")[2]));
  if (path === "/auth/login") return mockLogin(body);
  if (path === "/navigate") return mockNavigate();
  if (path === "/notifications") return { results: [], total: 0 };
  if (path === "/admin/buildings" && method === "GET") return mockBuildings();
  if (path === "/checkin" && method === "POST")
    return { on_campus: true, dist_km: 0.12 };
  return {};
}

const MOCK_FACULTY = [
  {
    id: 1,
    name: "Dr. Priya Sharma",
    designation: "Professor",
    dept_code: "CSE",
    department: "Computer Science",
    status: "available",
    status_message: "Open office hours today",
    employee_id: "CSE001",
    office_hours: "Mon-Fri 10-12",
    is_on_campus: true,
    room: { number: "205", name: "Staff Room" },
    specialization: "Machine Learning",
  },
  {
    id: 2,
    name: "Prof. Ramesh Kumar",
    designation: "Asst. Professor",
    dept_code: "CSE",
    department: "Computer Science",
    status: "in_class",
    status_message: "Lecture ends at 3 PM",
    employee_id: "CSE002",
    office_hours: "Mon-Wed 2-4",
    is_on_campus: true,
    room: { number: "301", name: "HOD Cabin" },
    specialization: "Networks",
  },
  {
    id: 3,
    name: "Dr. Anita Verma",
    designation: "Associate Prof.",
    dept_code: "ECE",
    department: "Electronics",
    status: "busy",
    status_message: "In research meeting",
    employee_id: "ECE001",
    office_hours: "Tue-Thu 11-1",
    is_on_campus: true,
    room: { number: "102", name: "ECE Office" },
    specialization: "VLSI Design",
  },
  {
    id: 4,
    name: "Prof. Suresh Yadav",
    designation: "Professor",
    dept_code: "MECH",
    department: "Mechanical Engg",
    status: "not_available",
    status_message: "Out of campus today",
    employee_id: "MCH001",
    office_hours: "Mon-Fri 9-11",
    is_on_campus: false,
    room: { number: "401", name: "MECH Lab" },
    specialization: "Thermodynamics",
  },
  {
    id: 5,
    name: "Dr. Kavita Singh",
    designation: "Asst. Professor",
    dept_code: "MATH",
    department: "Mathematics",
    status: "available",
    status_message: "Available for doubt sessions",
    employee_id: "MTH001",
    office_hours: "Daily 10-12",
    is_on_campus: true,
    room: { number: "115", name: "Math Dept" },
    specialization: "Algebra",
  },
  {
    id: 6,
    name: "Prof. Deepak Mishra",
    designation: "Senior Lecturer",
    dept_code: "CSE",
    department: "Computer Science",
    status: "available",
    status_message: "",
    employee_id: "CSE003",
    office_hours: "Mon-Fri 2-4",
    is_on_campus: true,
    room: { number: "206", name: "Staff Room" },
    specialization: "Data Structures",
  },
];

function mockFacultyList() {
  return { total: MOCK_FACULTY.length, page: 1, results: MOCK_FACULTY };
}
function mockFacultyDetail(id) {
  return MOCK_FACULTY.find((f) => f.id === id) || MOCK_FACULTY[0];
}
function mockLogin(body) {
  const map = {
    "admin@campus.edu": {
      id: 1,
      role: "admin",
      full_name: "System Admin",
    },
    "dr.sharma@campus.edu": {
      id: 2,
      role: "faculty",
      full_name: "Dr. Priya Sharma",
    },
    "student1@campus.edu": {
      id: 3,
      role: "student",
      full_name: "Arjun Mehta",
    },
  };
  const u = map[body?.email?.toLowerCase()];
  if (!u) throw new Error("Invalid credentials");
  return {
    token: "demo_token_" + u.role,
    role: u.role,
    name: u.full_name,
    id: u.id,
  };
}
function mockBuildings() {
  return [
    { id: 1, name: "CSE Block", short_code: "CSE-BLK" },
    { id: 2, name: "Science Block", short_code: "SCI-BLK" },
  ];
}
function mockNavigate() {
  return {
    outdoor: {
      destination_lat: 28.614,
      destination_lng: 77.2091,
      building_name: "CSE Block",
      distance_km: 0.28,
      eta_walk_min: 3.4,
    },
    indoor: {
      building: "CSE Block",
      floor_number: 2,
      floor_name: "Second Floor",
      room_number: "205",
      room_name: "Staff Room",
      steps: [
        {
          step: 1,
          icon: "door",
          text: "Enter CSE Block through the main entrance.",
        },
        {
          step: 2,
          icon: "stairs",
          text: "Take the staircase on your right to Floor 2.",
        },
        {
          step: 3,
          icon: "arrow",
          text: "Turn left at the landing and walk down the corridor.",
        },
        {
          step: 4,
          icon: "room",
          text: "Room 205 (Staff Room) is the third door on the right.",
        },
        {
          step: 5,
          icon: "pin",
          text: "You have arrived! Knock and check availability.",
        },
      ],
      room_coords: { x: 250, y: 100, w: 80, h: 50 },
    },
    faculty: { name: "Dr. Priya Sharma", status: "available" },
  };
}

// ─── FACULTY GRID ─────────────────────────────────
async function loadFaculty(q = "", dept = "", status = "") {
  showSkeletons();
  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (dept) params.set("dept", dept);
    if (status) params.set("status", status);

    const data = await api(`/faculty?${params}`);
    state.faculties = data.results || [];
    renderFacultyGrid(state.faculties);
    document.getElementById("countBadge").textContent =
      `${data.total || state.faculties.length} results`;
  } catch (e) {
    document.getElementById("facultyGrid").innerHTML =
      `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--red)">
        ⚠️ Could not load faculty data.<br>
        <span style="font-size:.85rem;color:var(--text2);margin-top:8px;display:block">
          Make sure Flask is running at ${API}
        </span>
       </div>`;
  }
}

function renderFacultyGrid(faculties) {
  const grid = document.getElementById("facultyGrid");
  const noRes = document.getElementById("noResults");
  if (!faculties.length) {
    grid.innerHTML = "";
    noRes.classList.remove("hidden");
    return;
  }
  noRes.classList.add("hidden");
  grid.innerHTML = faculties.map((f) => facultyCardHTML(f)).join("");
}

const STATUS_LABELS = {
  available: "Available",
  busy: "Busy",
  not_available: "Not Available",
  in_class: "In Class",
};
const STATUS_COLORS = {
  available: "#22d68a",
  busy: "#ffb04a",
  not_available: "#ff5b6b",
  in_class: "#9f7eff",
};

function facultyCardHTML(f) {
  const initials = f.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  const subbed = state.subscriptions.has(f.id);
  return `<div class="fc" onclick="openNavModal(${f.id})">
    <div class="fc-top">
      <div class="fc-avatar">
        ${initials}
        <div class="fc-status-dot" style="background:${STATUS_COLORS[f.status] || "#4a5e7a"}"></div>
      </div>
      <div class="fc-info">
        <div class="fc-name">${f.name}</div>
        <div class="fc-designation">${f.designation || ""}</div>
        <span class="fc-dept">${f.dept_code || f.department || ""}</span>
      </div>
    </div>
    <div class="fc-status-row">
      <div class="status-pill ${f.status}">
        <div class="dot"></div>
        ${STATUS_LABELS[f.status] || f.status}
      </div>
      ${f.is_on_campus ? '<span style="font-size:.75rem;color:var(--green)">● On Campus</span>' : '<span style="font-size:.75rem;color:var(--text3)">● Off Campus</span>'}
    </div>
    <div class="fc-msg">${f.status_message || ""}</div>
    <div class="fc-meta">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
      </svg>
      ${f.room ? `Room ${f.room.number}` : "No room assigned"}
    </div>
    <div class="fc-actions" onclick="event.stopPropagation()">
      <button class="btn-sm primary" onclick="openNavModal(${f.id})">🗺 Navigate</button>
      <button class="btn-sm ${subbed ? "subscribed" : ""}" onclick="quickSubscribe(event,${f.id})">
        ${subbed ? "🔔 Subscribed" : "🔔 Notify Me"}
      </button>
    </div>
  </div>`;
}

function showSkeletons() {
  const grid = document.getElementById("facultyGrid");
  grid.innerHTML = Array(6)
    .fill(
      `
    <div class="fc">
      <div class="fc-top">
        <div class="skeleton" style="width:52px;height:52px;border-radius:12px;flex-shrink:0"></div>
        <div style="flex:1">
          <div class="skeleton" style="height:16px;width:70%;margin-bottom:8px"></div>
          <div class="skeleton" style="height:12px;width:50%"></div>
        </div>
      </div>
      <div class="skeleton" style="height:40px;margin-top:14px"></div>
      <div class="skeleton" style="height:36px;margin-top:10px"></div>
    </div>`,
    )
    .join("");
}

// ─── SEARCH ───────────────────────────────────────
function debounceSearch() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(doSearch, 350);
}

function doSearch() {
  const q = document.getElementById("searchInput").value;
  const dept = document.getElementById("deptFilter").value;
  loadFaculty(q, dept, state.searchStatus);
}

function filterByStatus(el, status) {
  document
    .querySelectorAll(".chip")
    .forEach((c) => c.classList.remove("active"));
  el.classList.add("active");
  state.searchStatus = status;
  doSearch();
}

// ─── NAV MODAL ────────────────────────────────────
async function openNavModal(fid) {
  const f =
    state.faculties.find((x) => x.id === fid) || (await api(`/faculty/${fid}`));
  state.currentFaculty = f;
  const initials = f.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  document.getElementById("navModalTitle").textContent = f.name;
  document.getElementById("navFacAvatar").textContent = initials;
  document.getElementById("navFacName").textContent = f.name;
  document.getElementById("navFacDesig").textContent = f.designation || "";
  document.getElementById("navFacDept").textContent = f.department || "";
  document.getElementById("navFacEmp").textContent = f.employee_id
    ? `ID: ${f.employee_id}`
    : "";

  const msgBox = document.getElementById("navFacMsg");
  if (f.status_message) {
    msgBox.textContent = `"${f.status_message}"`;
    msgBox.style.display = "block";
  } else {
    msgBox.style.display = "none";
  }

  document.getElementById("navFacStatusRow").innerHTML =
    `<div class="status-pill ${f.status}" style="display:inline-flex">
      <div class="dot"></div> ${STATUS_LABELS[f.status]}
    </div>`;

  // Info tab
  document.getElementById("facultyInfoBlock").innerHTML = `
    <div style="display:grid;gap:12px">
      <div class="nav-meta-item"><span>🏢</span> <div><div style="color:var(--text2);font-size:.78rem">Location</div><strong>${f.room ? `Room ${f.room.number}` : "Not assigned"}</strong></div></div>
      <div class="nav-meta-item"><span>🕐</span> <div><div style="color:var(--text2);font-size:.78rem">Office Hours</div><strong>${f.office_hours || "Not specified"}</strong></div></div>
      <div class="nav-meta-item"><span>🔬</span> <div><div style="color:var(--text2);font-size:.78rem">Specialization</div><strong>${f.specialization || "N/A"}</strong></div></div>
    </div>`;

  // Subscribe btn
  const subBtn = document.getElementById("subscribeBtn");
  if (state.subscriptions.has(fid)) {
    subBtn.textContent = "🔕 Unsubscribe";
    subBtn.classList.add("subscribed");
  } else {
    subBtn.textContent = "🔔 Notify When Available";
    subBtn.classList.remove("subscribed");
  }

  openModal("navOverlay");
}

async function startOutdoorNav() {
  const f = state.currentFaculty;
  if (!f) return;
  document.getElementById("mapFallback").innerHTML =
    '<div style="color:var(--text2)">📡 Getting location…</div>';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const navData = await api(
        `/navigate?faculty_id=${f.id}&lat=${lat}&lng=${lng}`,
      );
      state.outdoorDestination = navData?.outdoor
        ? {
            lat: navData.outdoor.destination_lat,
            lng: navData.outdoor.destination_lng,
          }
        : null;
      renderNavigation(navData, lat, lng);
    },
    (err) => {
      // Use mock data if geolocation fails
      const navData = mockNavigate();
      renderNavigation(navData, 28.6138, 77.2088);
      showToast("Using demo location (geolocation denied)", "info");
    },
  );
}

function renderNavigation(data, userLat, userLng) {
  const { outdoor, indoor } = data;

  // Outdoor meta
  if (outdoor) {
    state.outdoorDestination = {
      lat: outdoor.destination_lat,
      lng: outdoor.destination_lng,
    };
    document.getElementById("outdoorMeta").innerHTML = `
      <div class="nav-meta-item"><span>📍</span><div><div style="color:var(--text2);font-size:.78rem">Distance</div><strong>${outdoor.distance_km} km</strong></div></div>
      <div class="nav-meta-item"><span>🚶</span><div><div style="color:var(--text2);font-size:.78rem">Walking ETA</div><strong>${outdoor.eta_walk_min} min</strong></div></div>
      <div class="nav-meta-item"><span>🏢</span><div><div style="color:var(--text2);font-size:.78rem">Building</div><strong>${outdoor.building_name}</strong></div></div>`;

    loadLeafletMap(
      userLat,
      userLng,
      state.outdoorDestination.lat,
      state.outdoorDestination.lng,
    );
  }

  // Indoor steps
  if (indoor) {
    const stepsHTML = indoor.steps
      .map(
        (s) => `
      <div class="nav-step">
        <div class="step-num">${s.step}</div>
        <div class="step-text">${s.text}</div>
      </div>`,
      )
      .join("");
    document.getElementById("indoorSteps").innerHTML =
      `
      <div style="font-size:.85rem;font-weight:600;color:var(--text2);margin-bottom:10px;font-family:var(--font-head)">
        ${indoor.building} · ${indoor.floor_name} · Room ${indoor.room_number}
      </div>` + stepsHTML;

    // Render SVG floor plan with highlighted room
    renderFloorMap(indoor);
  }
}

// 1. ISSE SCRIPT KE TOP PAR RAKHEIN (Functions ke bahar)

function loadLeafletMap(userLat, userLng, destLat, destLng) {
  const mapContainer = document.getElementById("google-map-container");
  const fallback = document.getElementById("mapFallback");

  // Basic Checks
  if (typeof L === "undefined") return;
  if (!mapContainer) return;

  // --- Proximity Logic (User already arrived) ---
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(destLat - userLat);
  const dLng = toRad(destLng - userLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(userLat)) *
      Math.cos(toRad(destLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const distanceMeters =
    2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (distanceMeters < 20) {
    showToast("You have arrived at the destination building.", "success");
    navTab(null, "tab-indoor");
    return;
  }

  // --- IMPORTANT FIX: Cleanup existing map instance ---
  if (leafletMap !== null) {
    leafletMap.off(); // Saare event listeners hatayein
    leafletMap.remove(); // Map object destroy karein
    leafletMap = null; // Reference clear karein
  }

  fallback.style.display = "none";

  // --- Map Initialization ---
  // Container ID string ke bajaye seedha element pass karein ya ID string use karein
  leafletMap = L.map("google-map-container", { zoomControl: true });

  // Satellite Layer
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; Source: Esri",
      maxZoom: 20,
    },
  ).addTo(leafletMap);

  // Labels Layer
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      subdomains: "abcd",
    },
  ).addTo(leafletMap);

  // Markers
  const userMarker = L.marker([userLat, userLng]).addTo(leafletMap);
  userMarker.bindPopup("You are here");

  const redMarkerIcon = L.icon({
    iconUrl:
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

  L.marker([destLat, destLng], { icon: redMarkerIcon })
    .addTo(leafletMap)
    .bindPopup("Faculty destination");

  // Routing
  if (L.Routing && typeof L.Routing.control === "function") {
    L.Routing.control({
      waypoints: [L.latLng(userLat, userLng), L.latLng(destLat, destLng)],
      lineOptions: {
        styles: [{ color: "#00FFFF", opacity: 0.9, weight: 6 }],
      },
      createMarker: () => null,
      addWaypoints: false,
      routeWhileDragging: false,
      show: false,
    }).addTo(leafletMap);
  }

  // Final Bounds
  leafletMap.fitBounds(
    L.latLngBounds([
      [userLat, userLng],
      [destLat, destLng],
    ]),
    { padding: [28, 28] },
  );

  // --- Force Resize (Modal fix) ---
  setTimeout(() => {
    leafletMap.invalidateSize();
  }, 200);
}

function renderFloorMap(indoor) {
  const svg = document.getElementById("floor-svg");
  const { room_coords: rc } = indoor;
  svg.innerHTML = `
    <rect width="500" height="300" fill="#141922" rx="8"/>
    <!-- Corridors -->
    <rect x="0" y="130" width="500" height="40" fill="#1a2235" rx="0"/>
    <text x="250" y="155" text-anchor="middle" fill="#4a5e7a" font-size="10" font-family="DM Sans">Main Corridor</text>
    <!-- Rooms row 1 -->
    ${[0, 1, 2, 3, 4]
      .map(
        (i) => `
      <rect x="${30 + i * 90}" y="40" width="70" height="80" fill="${i === 2 ? "rgba(79,138,255,.25)" : "#1f2a40"}"
        stroke="${i === 2 ? "#4f8aff" : "#253040"}" stroke-width="${i === 2 ? 2 : 1}" rx="4"/>
      <text x="${65 + i * 90}" y="83" text-anchor="middle" fill="${i === 2 ? "#7eb3ff" : "#4a5e7a"}"
        font-size="10" font-family="DM Sans">${200 + i + 1}</text>
      ${i === 2 ? `<text x="${65 + i * 90}" y="98" text-anchor="middle" fill="#4f8aff" font-size="8" font-family="DM Sans">← YOU ARE HERE →</text>` : ""}
    `,
      )
      .join("")}
    <!-- Rooms row 2 -->
    ${[0, 1, 2, 3, 4]
      .map(
        (i) => `
      <rect x="${30 + i * 90}" y="180" width="70" height="80" fill="#1f2a40"
        stroke="#253040" stroke-width="1" rx="4"/>
      <text x="${65 + i * 90}" y="223" text-anchor="middle" fill="#4a5e7a"
        font-size="10" font-family="DM Sans">${210 + i + 1}</text>
    `,
      )
      .join("")}
    <!-- Staircase -->
    <rect x="460" y="40" width="30" height="220" fill="#253040" rx="4"/>
    <text x="475" y="155" text-anchor="middle" fill="#4a5e7a" font-size="8" font-family="DM Sans"
      transform="rotate(-90,475,155)">STAIRS</text>
    <!-- You marker -->
    <circle cx="${65 + 2 * 90}" cy="60" r="6" fill="#4f8aff">
      <animate attributeName="r" values="6;9;6" dur="1.5s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite"/>
    </circle>
    <!-- Legend -->
    <rect x="10" y="270" width="12" height="12" fill="rgba(79,138,255,.25)" stroke="#4f8aff" stroke-width="1.5" rx="2"/>
    <text x="26" y="281" fill="#7d94b8" font-size="9" font-family="DM Sans">Target Room</text>
    <circle cx="120" cy="276" r="5" fill="#4f8aff"/>
    <text x="129" y="281" fill="#7d94b8" font-size="9" font-family="DM Sans">Your Position</text>
    <text x="10" y="296" fill="#4a5e7a" font-size="8" font-family="DM Sans">${indoor.building} · ${indoor.floor_name}</text>`;
}

// ─── AUTH ─────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("authError");
  const btn = document.querySelector("#loginForm .btn-full");

  // Basic validation
  if (!email || !password) {
    errEl.textContent = "Please enter both email and password.";
    errEl.style.display = "block";
    return;
  }

  // Show loading state
  btn.textContent = "Signing in…";
  btn.disabled = true;
  errEl.style.display = "none";

  try {
    const data = await api("/auth/login", "POST", { email, password });
    applyAuthPayload(data);

    closeModal("authOverlay");
    showUserNav(state.user);
    showToast(`Welcome back, ${data.name}! 👋`, "success");

    if (data.role === "faculty") {
      const ready = await ensureFacultyProfile();
      if (ready) showFacultyPage();
    } else if (data.role === "admin") showAdminPage();
    else {
      showPage("page-student");
      loadFaculty();
    }
  } catch (e) {
    errEl.textContent = e.message || "Login failed. Please try again.";
    errEl.style.display = "block";
  } finally {
    btn.textContent = "Sign In →";
    btn.disabled = false;
  }
}

async function doRegister() {
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const pass = document.getElementById("regPassword").value;
  const role = document.getElementById("regRole").value;
  const errEl = document.getElementById("authError");
  const btn = document.querySelector("#registerForm .btn-full");

  if (!name || !email || !pass) {
    errEl.textContent = "Please fill in name, email, and password.";
    errEl.style.display = "block";
    return;
  }

  btn.textContent = "Creating account…";
  btn.disabled = true;
  errEl.style.display = "none";

  try {
    await api("/auth/register", "POST", {
      full_name: name,
      email,
      password: pass,
      role,
    });

    if (role === "faculty") {
      const data = await api("/auth/login", "POST", { email, password: pass });
      applyAuthPayload(data);
      closeModal("authOverlay");
      showUserNav(state.user);
      showToast("Account created! Complete your faculty profile.", "success");
      await openFacultyProfileSetup();
    } else {
      showToast("Account created! Please sign in.", "success");
      showLogin();
    }
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = "block";
  } finally {
    btn.textContent = "Create Account →";
    btn.disabled = false;
  }
}

function toggleFacultyRegHint() {
  const isFaculty = document.getElementById("regRole").value === "faculty";
  document
    .getElementById("facultyRegHint")
    .classList.toggle("hidden", !isFaculty);
}

async function loadDepartments() {
  const sel = document.getElementById("fpDept");
  try {
    const data = await api("/departments");
    const depts = data.results || [];
    if (!depts.length) {
      sel.innerHTML =
        '<option value="">No departments — ask admin to add some</option>';
      return;
    }
    sel.innerHTML =
      '<option value="">Select department…</option>' +
      depts
        .map(
          (d) =>
            `<option value="${d.id}">${d.name} (${d.short_code})</option>`,
        )
        .join("");
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load departments</option>';
    showToast(e.message, "error");
  }
}

async function openFacultyProfileSetup() {
  document.getElementById("facultyProfileError").style.display = "none";
  document.getElementById("fpEmployeeId").value = "";
  document.getElementById("fpDesignation").value = "";
  document.getElementById("fpSpecialization").value = "";
  document.getElementById("fpOfficeHours").value = "";
  await loadDepartments();
  openModal("facultyProfileOverlay");
}

async function ensureFacultyProfile() {
  if (!state.token || state.user?.role !== "faculty") return true;
  if (state.user.faculty_profile_complete && state.facultyId) return true;

  try {
    const data = await api("/auth/faculty-profile");
    if (data.complete && data.profile) {
      state.facultyId = data.profile.id;
      state.user.faculty_id = data.profile.id;
      state.user.faculty_profile_complete = true;
      persistUser();
      return true;
    }
    await openFacultyProfileSetup();
    return false;
  } catch (e) {
    showToast(e.message, "error");
    return false;
  }
}

async function submitFacultyProfile() {
  const errEl = document.getElementById("facultyProfileError");
  const btn = document.querySelector("#facultyProfileForm .btn-full");
  const department_id = parseInt(document.getElementById("fpDept").value, 10);
  const employee_id = document.getElementById("fpEmployeeId").value.trim();
  const designation = document.getElementById("fpDesignation").value.trim();
  const specialization = document
    .getElementById("fpSpecialization")
    .value.trim();
  const office_hours = document.getElementById("fpOfficeHours").value.trim();

  if (!department_id || !employee_id || !designation) {
    errEl.textContent =
      "Department, employee ID, and designation are required.";
    errEl.style.display = "block";
    return;
  }

  btn.textContent = "Saving…";
  btn.disabled = true;
  errEl.style.display = "none";

  try {
    const data = await api("/auth/faculty-profile", "POST", {
      department_id,
      employee_id,
      designation,
      specialization: specialization || undefined,
      office_hours: office_hours || undefined,
    });
    state.facultyId = data.faculty_id;
    state.user.faculty_id = data.faculty_id;
    state.user.faculty_profile_complete = true;
    persistUser();
    closeModal("facultyProfileOverlay");
    showToast("Faculty profile saved! You can update your status now.", "success");
    showFacultyPage();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = "block";
  } finally {
    btn.textContent = "Save Profile & Continue →";
    btn.disabled = false;
  }
}

function logout() {
  state.token = null;
  state.user = null;
  state.facultyId = null;
  localStorage.removeItem("sfls_token");
  localStorage.removeItem("sfls_user");
  document.getElementById("authButtons").classList.remove("hidden");
  document.getElementById("userMenu").classList.add("hidden");
  showPage("page-student");
  loadFaculty();
  showToast("Signed out successfully", "info");
}

function showUserNav(user) {
  document.getElementById("authButtons").classList.add("hidden");
  document.getElementById("userMenu").classList.remove("hidden");
  document.getElementById("navName").textContent = user.name;
  document.getElementById("navAvatar").textContent = user.name[0].toUpperCase();
}

// ─── FACULTY DASHBOARD ────────────────────────────
let selectedStatusVal = null;

async function showFacultyPage() {
  showPage("page-faculty");

  const ready = await ensureFacultyProfile();
  if (!ready) return;

  document.getElementById("fpName").textContent = state.user?.name || "Faculty";

  try {
    const data = await api("/auth/faculty-profile");
    if (!data.complete || !data.profile) {
      await openFacultyProfileSetup();
      return;
    }
    const me = data.profile;
    state.facultyId = me.id;
    state.user.faculty_id = me.id;
    persistUser();

    document.getElementById("fpDesig").textContent =
      [me.designation, me.department].filter(Boolean).join(" · ") ||
      "Update your availability for students";
    document.getElementById("fpCurrentStatus").textContent =
      STATUS_LABELS[me.status] || "Unknown";
    selectStatusByValue(me.status);
    document.getElementById("statusMsg").value = me.status_message || "";
  } catch (e) {
    showToast(e.message, "error");
  }
}

function selectStatus(el) {
  document
    .querySelectorAll(".status-card")
    .forEach((c) => c.classList.remove("selected"));
  el.classList.add("selected");
  selectedStatusVal = el.dataset.s;
}

function selectStatusByValue(val) {
  const el = document.querySelector(`.status-card[data-s="${val}"]`);
  if (el) selectStatus(el);
}

async function saveStatus() {
  if (!selectedStatusVal) {
    showToast("Please select a status", "error");
    return;
  }

  if (!state.facultyId) {
    const ready = await ensureFacultyProfile();
    if (!ready || !state.facultyId) {
      showToast("Complete your faculty profile first", "error");
      return;
    }
  }

  const msg = document.getElementById("statusMsg").value;
  const fid = state.facultyId;

  try {
    await api(`/faculty/${fid}/status`, "PATCH", {
      status: selectedStatusVal,
      message: msg,
    });
    document.getElementById("fpCurrentStatus").textContent =
      STATUS_LABELS[selectedStatusVal];
    const f = state.faculties.find((x) => x.id === fid);
    if (f) {
      f.status = selectedStatusVal;
      f.status_message = msg;
    }
    showToast("Status updated successfully! 🎉", "success");
    renderFacultyGrid(state.faculties);
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function doCheckin() {
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const res = await api("/checkin", "POST", {
        lat,
        lng,
        ssid: "CampusNet",
      });
      const badge = document.getElementById("wifiStatusBadge");
      const sub = document.getElementById("wifiSub");
      if (res.on_campus) {
        badge.className = "wifi-status on";
        badge.textContent = "On Campus";
        sub.textContent = `Last check-in: ${new Date().toLocaleTimeString()} — ${res.dist_km}km from center`;
      } else {
        badge.className = "wifi-status off";
        badge.textContent = "Off Campus";
        sub.textContent = "Status auto-updated to Not Available";
      }
      showToast(
        res.on_campus
          ? "✅ On Campus — checked in!"
          : "📍 Off Campus — status updated",
        "info",
      );
    },
    () => {
      showToast("⚠️ Geolocation denied. Manual check-in used.", "error");
      // Simulate on-campus
      document.getElementById("wifiStatusBadge").className = "wifi-status on";
      document.getElementById("wifiStatusBadge").textContent = "On Campus";
    },
  );
}

// ─── ADMIN DASHBOARD ──────────────────────────────
function showAdminPage() {
  showPage("page-admin");
  loadAdminFaculty();
  loadDemoSeatingGrid();
  populateBuildingsList();
}

function adminTab(btn, tabId) {
  document
    .querySelectorAll(".admin-tab")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".admin-tab-panel")
    .forEach((p) => p.classList.add("hidden"));
  btn.classList.add("active");
  document.getElementById(tabId).classList.remove("hidden");
}

async function addBuilding() {
  const payload = {
    name: document.getElementById("bldgName").value,
    short_code: document.getElementById("bldgCode").value,
    lat: parseFloat(document.getElementById("bldgLat").value),
    lng: parseFloat(document.getElementById("bldgLng").value),
    entrance_lat: parseFloat(document.getElementById("bldgEntLat").value),
    entrance_lng: parseFloat(document.getElementById("bldgEntLng").value),
  };
  if (!payload.name || !payload.short_code) {
    showToast("Name and code required", "error");
    return;
  }
  await api("/admin/buildings", "POST", payload);
  showToast("Building added!", "success");
  populateBuildingsList();
}

async function populateBuildingsList() {
  const buildings = await api("/admin/buildings");
  document.getElementById("buildingsList").innerHTML = buildings.map
    ? buildings
        .map(
          (b) =>
            `<div class="nav-meta-item" style="margin-bottom:8px">
      <span>🏢</span><div><strong>${b.name}</strong><div style="font-size:.75rem;color:var(--text2)">${b.short_code}</div></div>
    </div>`,
        )
        .join("")
    : "";
}

async function addFloor() {
  const payload = {
    building_id: parseInt(document.getElementById("floorBldg").value),
    floor_number: parseInt(document.getElementById("floorNum").value),
    floor_name: document.getElementById("floorName").value,
  };
  await api("/admin/floors", "POST", payload);
  showToast("Floor added!", "success");
}

async function addRoom() {
  const payload = {
    floor_id: parseInt(document.getElementById("roomFloor").value),
    room_number: document.getElementById("roomNum").value,
    room_name: document.getElementById("roomName").value,
    room_type: document.getElementById("roomType").value,
    x: parseInt(document.getElementById("roomX").value) || 0,
    y: parseInt(document.getElementById("roomY").value) || 0,
  };
  await api("/admin/rooms", "POST", payload);
  showToast("Room added!", "success");
}

function loadDemoSeatingGrid() {
  const grid = document.getElementById("seatingGrid");
  const seats = [];
  const allocated = {
    A1: "Dr. Sharma",
    B3: "Prof. Kumar",
    C2: "Dr. Verma",
  };
  ["A", "B", "C", "D", "E"].forEach((row) => {
    [1, 2, 3, 4, 5].forEach((col) => {
      const label = `${row}${col}`;
      const name = allocated[label] || "";
      seats.push({ label, name, allocated: !!name });
    });
  });
  grid.innerHTML = seats
    .map(
      (s) => `
    <div class="seat-cell ${s.allocated ? "allocated" : ""}" data-seat="${s.label}"
      onclick="selectSeat(this,'${s.label}')">
      <span class="seat-label">${s.label}</span>
      ${s.name ? `<span class="seat-name">${s.name.split(" ")[1] || s.name}</span>` : ""}
    </div>`,
    )
    .join("");

  // Populate faculty select
  const fsel = document.getElementById("seatFaculty");
  fsel.innerHTML =
    '<option value="">Select Faculty</option>' +
    MOCK_FACULTY.map((f) => `<option value="${f.id}">${f.name}</option>`).join(
      "",
    );
}

function selectSeat(el, label) {
  document
    .querySelectorAll(".seat-cell")
    .forEach((c) => c.classList.remove("selected"));
  el.classList.add("selected");
  state.selectedSeat = label;
}

async function assignSeat() {
  if (!state.selectedSeat) {
    showToast("Select a seat first", "error");
    return;
  }
  const fid = document.getElementById("seatFaculty").value;
  if (!fid) {
    showToast("Select a faculty first", "error");
    return;
  }
  const fac = MOCK_FACULTY.find((f) => f.id == fid);
  await api("/admin/seats/allocate", "POST", {
    seat_id: 1,
    faculty_id: parseInt(fid),
  });
  // Update UI
  const cell = document.querySelector(
    `.seat-cell[data-seat="${state.selectedSeat}"]`,
  );
  if (cell) {
    cell.classList.add("allocated");
    cell.innerHTML = `<span class="seat-label">${state.selectedSeat}</span>
      <span class="seat-name">${fac?.name?.split(" ")[1] || ""}</span>`;
  }
  showToast(`Seat ${state.selectedSeat} assigned to ${fac?.name}!`, "success");
  state.selectedSeat = null;
}

function loadAdminFaculty() {
  document.getElementById("adminFacultyList").innerHTML = MOCK_FACULTY.map(
    (f) => `
    <div class="fc" onclick="">
      <div class="fc-top">
        <div class="fc-avatar" style="width:40px;height:40px;font-size:1rem">
          ${f.name
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div class="fc-info">
          <div class="fc-name">${f.name}</div>
          <div class="fc-designation">${f.designation}</div>
        </div>
      </div>
      <div class="fc-status-row">
        <div class="status-pill ${f.status}"><div class="dot"></div>${STATUS_LABELS[f.status]}</div>
      </div>
      <div class="fc-actions" style="margin-top:10px">
        ${["available", "busy", "not_available", "in_class"]
          .map(
            (s) =>
              `<button class="btn-sm ${s === f.status ? "primary" : ""}" style="font-size:.72rem;padding:5px"
            onclick="adminOverrideStatus(${f.id},'${s}',this)">${STATUS_LABELS[s]}</button>`,
          )
          .join("")}
      </div>
    </div>`,
  ).join("");
}

async function adminOverrideStatus(fid, status, btn) {
  await api(`/faculty/${fid}/status`, "PATCH", {
    status,
    message: "[Admin Override]",
  });
  const f = MOCK_FACULTY.find((x) => x.id === fid);
  if (f) f.status = status;
  showToast(`Status overridden to ${STATUS_LABELS[status]}`, "success");
  loadAdminFaculty();
}

// ─── NOTIFICATIONS ────────────────────────────────
function toggleNotifPanel() {
  document.getElementById("notifPanel").classList.toggle("open");
}

async function loadNotifications() {
  const data = await api("/notifications");
  const list = data.results || [];
  const badge = document.getElementById("notifBadge");
  const unread = list.filter((n) => !n.is_read).length;
  if (unread > 0) {
    badge.style.display = "flex";
    badge.textContent = unread;
  } else {
    badge.style.display = "none";
  }
  document.getElementById("notifList").innerHTML = list.length
    ? list
        .map(
          (n) => `
    <div class="notif-item ${n.is_read ? "read" : "unread"}" onclick="markRead(${n.id})">
      <div class="notif-dot"></div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-text">${n.body || ""}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>`,
        )
        .join("")
    : '<div class="notif-empty">No notifications</div>';
}

async function markRead(id) {
  await api("/notifications/read", "PATCH", { ids: [id] });
  loadNotifications();
}

async function markAllRead() {
  // Demo only
  document.getElementById("notifBadge").style.display = "none";
  document.getElementById("notifList").innerHTML =
    '<div class="notif-empty">All caught up! ✓</div>';
}

async function toggleSubscribe() {
  const f = state.currentFaculty;
  if (!f) return;
  const subbed = state.subscriptions.has(f.id);
  if (subbed) {
    await api(`/subscribe/${f.id}`, "DELETE");
    state.subscriptions.delete(f.id);
    document.getElementById("subscribeBtn").textContent =
      "🔔 Notify When Available";
    document.getElementById("subscribeBtn").classList.remove("subscribed");
    showToast("Unsubscribed from notifications", "info");
  } else {
    await api(`/subscribe/${f.id}`, "POST");
    state.subscriptions.add(f.id);
    document.getElementById("subscribeBtn").textContent = "🔕 Unsubscribe";
    document.getElementById("subscribeBtn").classList.add("subscribed");
    showToast(`You'll be notified when ${f.name} is available! 🔔`, "success");
  }
  localStorage.setItem("sfls_subs", JSON.stringify([...state.subscriptions]));
  // re-render cards
  renderFacultyGrid(state.faculties);
}

async function quickSubscribe(evt, fid) {
  evt.stopPropagation();
  if (state.subscriptions.has(fid)) {
    state.subscriptions.delete(fid);
    showToast("Unsubscribed", "info");
  } else {
    state.subscriptions.add(fid);
    showToast("Subscribed! You'll be notified when available 🔔", "success");
  }
  localStorage.setItem("sfls_subs", JSON.stringify([...state.subscriptions]));
  renderFacultyGrid(state.faculties);
}

function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ─── WEBSOCKET ────────────────────────────────────
function connectWebSocket() {
  if (typeof io === "undefined") return; // Socket.IO not loaded in demo
  const socket = io(API.replace("/api", ""));
  socket.emit("join", { room: "global_feed" });
  socket.on("status_update", (data) => {
    // Update mock
    const f = MOCK_FACULTY.find((x) => x.id === data.faculty_id);
    if (f) {
      f.status = data.new_status;
      if (data.message) f.status_message = data.message;
    }
    renderFacultyGrid(state.faculties);
    // Push browser notification
    if (
      state.subscriptions.has(data.faculty_id) &&
      data.new_status === "available"
    ) {
      if (Notification.permission === "granted") {
        new Notification(`${data.name} is now Available`, {
          body: data.message || "",
          icon: "/favicon.ico",
        });
      }
      showToast(`${data.name} is now available!`, "success");
    }
  });
  state.ws = socket;
}

// ─── MODAL HELPERS ────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  document.body.style.overflow = "";
}
function closeIfBg(e, id) {
  if (e.target.id === id) closeModal(id);
}
function openAuthModal() {
  openModal("authOverlay");
}

function navTab(btn, tabId) {
  document
    .querySelectorAll(".nav-tab")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("active"));
  if (btn) btn.classList.add("active");
  else {
    const targetBtn = document.querySelector(
      `[onclick="navTab(this, '${tabId}')"]`,
    );
    if (targetBtn) targetBtn.classList.add("active");
  }
  document.getElementById(tabId).classList.add("active");
  if (tabId === "tab-outdoor" && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 120);
  }
}

function showLogin() {
  document.getElementById("loginForm").classList.remove("hidden");
  document.getElementById("registerForm").classList.add("hidden");
  document.getElementById("authTitle").textContent = "Sign In";
  document.getElementById("authError").style.display = "none";
}
function showRegister() {
  document.getElementById("loginForm").classList.add("hidden");
  document.getElementById("registerForm").classList.remove("hidden");
  document.getElementById("authTitle").textContent = "Create Account";
  document.getElementById("authError").style.display = "none";
  toggleFacultyRegHint();
}

function showPage(id) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
}

function shareLocation() {
  const f = state.currentFaculty;
  if (!f) return;
  const url = `${location.origin}?faculty=${f.id}`;
  if (navigator.share) navigator.share({ title: f.name, url });
  else {
    navigator.clipboard.writeText(url);
    showToast("Link copied!", "info");
  }
}

// ─── TOAST ────────────────────────────────────────
function showToast(msg, type = "info") {
  const ct = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  ct.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(40px)";
    t.style.transition = ".3s";
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ─── UTILS ────────────────────────────────────────
function timeAgo(isoStr) {
  const diff = (Date.now() - new Date(isoStr)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── URL deep link ─────────────────────────────────
const urlParams = new URLSearchParams(location.search);
const deepFac = urlParams.get("faculty");
if (deepFac) {
  setTimeout(() => openNavModal(parseInt(deepFac)), 600);
}

// Demo hints
setTimeout(() => {
  showToast("🎓 Demo: Sign in as admin@campus.edu (any password)", "info");
}, 1500);
