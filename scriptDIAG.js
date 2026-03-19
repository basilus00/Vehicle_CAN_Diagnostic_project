console.log("🚗 OBD-II + GPS Dashboard loaded");

// ================= CHART.JS GAUGE SETUP =================
const gaugeOptions = {
  type: 'doughnut',
  options: {
    responsive: true,
    maintainAspectRatio: false,
    circumference: 180,
    rotation: 270,
    cutout: '75%',
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    }
  }
};

// ================= MQTT CONFIG =================
const brokerIP = "localhost";
const espId = "Na7la";
const wsUrl = `ws://${brokerIP}:9001`;

let client;
let obd2MessageCount = 0;
let gpsMessageCount = 0;
let connectionStartTime;

// ================= GAUGE CHARTS =================
let rpmChart, speedChart, coolantChart, intakeChart, loadChart, throttleChart, mafChart;

// ================= DATA STORAGE =================
let obd2Data = {
  rpm: 0,
  speed: 0,
  coolant: 0,
  intake: 0,
  load: 0,
  throttle: 0,
  maf: 0
};

let gpsData = {
  lat: null,
  lng: null,
  alt: null,
  sat: null,
  hdop: null,
  speed: null,
  course: null
};

// ================= MAP VARIABLES =================
let map;
let marker;
let polyline;
let locations = [];
let totalDistance = 0;

// ================= CREATE GAUGES =================
function createGauges() {
  const ctx = (id) => document.getElementById(id).getContext('2d');

  rpmChart = new Chart(ctx('rpmGauge'), {
    ...gaugeOptions,
    data: {
      labels: ['RPM'],
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d4ff', '#1a1a2e'],
        borderColor: '#0f3460',
        borderWidth: 2
      }]
    }
  });

  speedChart = new Chart(ctx('speedGauge'), {
    ...gaugeOptions,
    data: {
      labels: ['Speed'],
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d4ff', '#1a1a2e'],
        borderColor: '#0f3460',
        borderWidth: 2
      }]
    }
  });

  coolantChart = new Chart(ctx('coolantGauge'), {
    ...gaugeOptions,
    data: {
      labels: ['Coolant'],
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d4ff', '#1a1a2e'],
        borderColor: '#0f3460',
        borderWidth: 2
      }]
    }
  });

  intakeChart = new Chart(ctx('intakeGauge'), {
    ...gaugeOptions,
    data: {
      labels: ['Intake'],
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d4ff', '#1a1a2e'],
        borderColor: '#0f3460',
        borderWidth: 2
      }]
    }
  });

  loadChart = new Chart(ctx('loadGauge'), {
    ...gaugeOptions,
    data: {
      labels: ['Load'],
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d4ff', '#1a1a2e'],
        borderColor: '#0f3460',
        borderWidth: 2
      }]
    }
  });

  throttleChart = new Chart(ctx('throttleGauge'), {
    ...gaugeOptions,
    data: {
      labels: ['Throttle'],
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d4ff', '#1a1a2e'],
        borderColor: '#0f3460',
        borderWidth: 2
      }]
    }
  });

  mafChart = new Chart(ctx('mafGauge'), {
    ...gaugeOptions,
    data: {
      labels: ['MAF'],
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d4ff', '#1a1a2e'],
        borderColor: '#0f3460',
        borderWidth: 2
      }]
    }
  });

  console.log("✅ All OBD-II gauges created");
}

// ================= INITIALIZE MAP =================
function initMap() {
  console.log("Initializing Leaflet map...");
  
  map = L.map('map').setView([35.8567, 10.5951], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    minZoom: 2
  }).addTo(map);

  console.log("✅ Map initialized");
}

// ================= UPDATE GAUGE =================
function updateGauge(chart, value, max) {
  const percentage = Math.min((value / max) * 100, 100);
  chart.data.datasets[0].data = [percentage, 100 - percentage];
  
  let color = '#00d4ff';
  if (percentage > 80) color = '#ffa500';
  if (percentage > 95) color = '#ff0055';
  
  chart.data.datasets[0].backgroundColor = [color, '#1a1a2e'];
  chart.update('none');
}

// ================= MQTT CONNECTION =================
function connectMQTT() {
  console.log("Connecting to MQTT at " + wsUrl);

  client = mqtt.connect(wsUrl, {
    clientId: 'obd2_gps_dashboard_' + Math.random().toString(16).substr(2, 8),
    reconnectPeriod: 3000,
    clean: true
  });

  client.on('connect', () => {
    console.log("✅ Connected to MQTT broker");
    updateStatus(true);
    connectionStartTime = Date.now();

    // Subscribe to OBD-II topics
    const obdTopics = ['rpm', 'speed', 'coolant', 'intake', 'load', 'throttle', 'maf'];
    obdTopics.forEach(topic => {
      client.subscribe(`${espId}/obd2/${topic}`);
    });

    // Subscribe to GPS topics
    const gpsTopics = ['latitude', 'longitude', 'altitude', 'satellites', 'hdop', 'speed', 'course'];
    gpsTopics.forEach(topic => {
      client.subscribe(`${espId}/gps/${topic}`);
    });

    console.log("📨 Subscribed to OBD-II and GPS topics");
  });

  client.on('message', (topic, message) => {
    const value = parseFloat(message.toString());
    const param = topic.split('/').pop();
    const type = topic.includes('obd2') ? 'obd2' : 'gps';

    console.log(`📨 ${type.toUpperCase()} - ${param}: ${value}`);

    if (type === 'obd2') {
      handleOBDMessage(param, value);
    } else {
      handleGPSMessage(param, value);
    }
  });

  client.on('error', (err) => {
    console.error("❌ MQTT Error:", err);
    updateStatus(false);
  });

  client.on('offline', () => {
    console.log("⚠️ MQTT Offline");
    updateStatus(false);
  });

  client.on('reconnect', () => {
    console.log("🔄 Reconnecting to MQTT...");
  });
}

// ================= HANDLE OBD MESSAGE =================
function handleOBDMessage(param, value) {
  obd2MessageCount++;
  document.getElementById('obd2MessageCount').textContent = obd2MessageCount;

  switch (param) {
    case 'rpm':
      obd2Data.rpm = value;
      updateGauge(rpmChart, value, 8000);
      document.getElementById('rpmDisplay').textContent = value.toFixed(0) + ' RPM';
      break;

    case 'speed':
      obd2Data.speed = value;
      updateGauge(speedChart, value, 250);
      document.getElementById('speedDisplay').textContent = value.toFixed(0) + ' km/h';
      break;

    case 'coolant':
      obd2Data.coolant = value;
      const coolantPercent = ((value + 40) / 170) * 100;
      updateGauge(coolantChart, Math.max(0, coolantPercent), 100);
      document.getElementById('coolantDisplay').textContent = value.toFixed(1) + ' °C';
      break;

    case 'intake':
      obd2Data.intake = value;
      const intakePercent = ((value + 40) / 165) * 100;
      updateGauge(intakeChart, Math.max(0, intakePercent), 100);
      document.getElementById('intakeDisplay').textContent = value.toFixed(1) + ' °C';
      break;

    case 'load':
      obd2Data.load = value;
      updateGauge(loadChart, value, 100);
      document.getElementById('loadDisplay').textContent = value.toFixed(1) + ' %';
      break;

    case 'throttle':
      obd2Data.throttle = value;
      updateGauge(throttleChart, value, 100);
      document.getElementById('throttleDisplay').textContent = value.toFixed(1) + ' %';
      break;

    case 'maf':
      obd2Data.maf = value;
      updateGauge(mafChart, value, 100);
      document.getElementById('mafDisplay').textContent = value.toFixed(1) + ' g/s';
      break;
  }

  // ================= AI DIAGNOSTICS =================
  // Run AI Diagnostics on each OBD update
  const currentOBDData = {
    rpm: obd2Data.rpm,
    speed: obd2Data.speed,
    coolant: obd2Data.coolant,
    intake: obd2Data.intake,
    load: obd2Data.load,
    throttle: obd2Data.throttle,
    maf: obd2Data.maf
  };

  // Run AI diagnostics
  if (window.AIdiagnostics) {
    const problems = window.AIdiagnostics.runDiagnostics(currentOBDData);
    updateDiagnosticsStats();
  }

  updateLastUpdate();
}

// ================= HANDLE GPS MESSAGE =================
function handleGPSMessage(param, value) {
  gpsMessageCount++;
  document.getElementById('gpsMessageCount').textContent = gpsMessageCount;

  switch (param) {
    case 'latitude':
      gpsData.lat = value;
      document.getElementById('gpsLatitude').textContent = value.toFixed(6) + '°';
      break;

    case 'longitude':
      gpsData.lng = value;
      document.getElementById('gpsLongitude').textContent = value.toFixed(6) + '°';
      break;

    case 'altitude':
      gpsData.alt = value;
      document.getElementById('gpsAltitude').textContent = value.toFixed(2) + ' m';
      break;

    case 'satellites':
      gpsData.sat = parseInt(value);
      document.getElementById('gpsSatellites').textContent = gpsData.sat;
      break;

    case 'hdop':
      gpsData.hdop = value;
      document.getElementById('gpsHDOP').textContent = value.toFixed(1);
      break;

    case 'speed':
      gpsData.speed = value;
      document.getElementById('gpsSpeedVal').textContent = value.toFixed(2) + ' km/h';
      break;

    case 'course':
      gpsData.course = value;
      const cardinal = getCardinal(value);
      document.getElementById('gpsCourse').textContent = value.toFixed(1) + '° ' + cardinal;
      break;
  }

  // Update map when we have both lat and lng
  if (gpsData.lat && gpsData.lng) {
    updateMap();
  }

  updateLastUpdate();
}

// ================= UPDATE MAP =================
function updateMap() {
  if (!gpsData.lat || !gpsData.lng) return;

  const latLng = [gpsData.lat, gpsData.lng];

  // Remove old marker
  if (marker) {
    map.removeLayer(marker);
  }

  // Add new marker
  const blueIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  marker = L.marker(latLng, {
    icon: blueIcon,
    title: "Current Position"
  }).bindPopup(`
    <div style="font-family: Arial; font-size: 12px; color: black;">
      <b>📍 Current Location</b><br>
      Lat: ${gpsData.lat.toFixed(6)}°<br>
      Lng: ${gpsData.lng.toFixed(6)}°<br>
      Alt: ${gpsData.alt?.toFixed(2) || '--'} m<br>
      Sats: ${gpsData.sat || '--'}<br>
      HDOP: ${gpsData.hdop?.toFixed(1) || '--'}
    </div>
  `).addTo(map);

  marker.openPopup();

  // Calculate distance from previous point
  if (locations.length > 0) {
    const lastLocation = locations[locations.length - 1];
    const distance = calculateDistance(
      lastLocation[0], lastLocation[1],
      gpsData.lat, gpsData.lng
    );
    totalDistance += distance;
  }

  // Add to location history
  locations.push(latLng);

  // Update polyline
  if (polyline) {
    map.removeLayer(polyline);
  }

  if (locations.length > 1) {
    polyline = L.polyline(locations, {
      color: 'blue',
      weight: 3,
      opacity: 0.7,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '5, 5'
    }).addTo(map);

    // Add start marker
    const greenIcon = new L.Icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    L.marker(locations[0], {
      icon: greenIcon,
      title: "Start Point"
    }).addTo(map).bindPopup("<b>🟢 Start</b>");
  }

  // Center map
  map.setView(latLng, 16);

  // Update distance display
  document.getElementById('gpsDistance').textContent = totalDistance.toFixed(3) + ' km';
}

// ================= UPDATE DIAGNOSTICS STATS =================
function updateDiagnosticsStats() {
  const stats = window.AIdiagnostics.getProblemStats();
  
  document.getElementById('statCritical').textContent = stats.critical;
  document.getElementById('statWarning').textContent = stats.warning;
  document.getElementById('statInfo').textContent = stats.info;

  // Change header color based on severity
  const header = document.querySelector('.diagnostics-header');
  if (stats.critical > 0) {
    header.style.borderBottomColor = '#ff0055';
  } else if (stats.warning > 0) {
    header.style.borderBottomColor = '#ffa500';
  } else {
    header.style.borderBottomColor = 'rgba(0, 212, 255, 0.2)';
  }
}

// ================= HELPER FUNCTIONS =================
function getCardinal(degree) {
  const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degree / 22.5) % 16;
  return cardinals[index];
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function updateStatus(connected) {
  const statusDot = document.getElementById('mqttStatus');
  const statusText = document.getElementById('statusText');

  if (connected) {
    statusDot.classList.remove('offline');
    statusDot.classList.add('connected');
    statusText.textContent = '🟢 Connected';
  } else {
    statusDot.classList.remove('connected');
    statusDot.classList.add('offline');
    statusText.textContent = '🔴 Disconnected';
  }
}

function updateLastUpdate() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });
  document.getElementById('lastUpdate').textContent = time;
}

function updateConnectionTime() {
  if (connectionStartTime) {
    const elapsed = Date.now() - connectionStartTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    const timeStr = `${hours}h ${minutes}m ${seconds}s`;
    document.getElementById('connectionTime').textContent = timeStr;
  }
}

// ================= MAP CONTROLS =================
document.getElementById('centerBtn').addEventListener('click', () => {
  if (gpsData.lat && gpsData.lng) {
    map.setView([gpsData.lat, gpsData.lng], 16);
    console.log("📍 Centered on current location");
  }
});

document.getElementById('clearBtn').addEventListener('click', () => {
  locations = [];
  totalDistance = 0;
  if (polyline) {
    map.removeLayer(polyline);
  }
  document.getElementById('gpsDistance').textContent = '-- km';
  console.log("🗑️ Track cleared");
});

// ================= INITIALIZE =================
console.log("Initializing OBD-II + GPS Dashboard...");
createGauges();
initMap();
connectMQTT();

setInterval(updateConnectionTime, 1000);
setInterval(updateDiagnosticsStats, 5000);

console.log("✅ OBD-II + GPS Dashboard initialized");