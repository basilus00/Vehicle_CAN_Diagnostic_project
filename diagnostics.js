console.log("🔧 AI Diagnostics Engine loaded");

// ================= DIAGNOSTICS DATABASE =================
const diagnosticsDB = {
  problems: [],
  history: [],
  maxHistoryItems: 50
};

// Problem severity levels
const SEVERITY = {
  CRITICAL: { level: 3, color: '#ff0055', label: 'CRITICAL' },
  WARNING: { level: 2, color: '#ffa500', label: 'WARNING' },
  INFO: { level: 1, color: '#00d4ff', label: 'INFO' }
};

// ================= PROBLEM DEFINITIONS =================
const problemDefinitions = {
  ENGINE_OVERHEATING: {
    id: 'engine_overheating',
    name: '🔥 Engine Overheating',
    description: 'Coolant temperature critically high',
    severity: SEVERITY.CRITICAL,
    check: (data) => data.coolant > 120,
    threshold: 120,
    action: 'STOP ENGINE. Check coolant level, thermostat, and radiator fan.'
  },

  INTAKE_TEMP_HIGH: {
    id: 'intake_temp_high',
    name: '🌡️ High Intake Temperature',
    description: 'Intake air temperature abnormally high',
    severity: SEVERITY.WARNING,
    check: (data) => data.intake > 110,
    threshold: 110,
    action: 'Check air intake filter, ensure proper airflow to engine.'
  },

  ENGINE_LOAD_CRITICAL: {
    id: 'engine_load_critical',
    name: '⚡ Critical Engine Load',
    description: 'Engine load exceeding 90%',
    severity: SEVERITY.CRITICAL,
    check: (data) => data.load > 90,
    threshold: 90,
    action: 'Reduce load immediately. Check for transmission issues, heavy towing.'
  },

  ENGINE_LOAD_HIGH: {
    id: 'engine_load_high',
    name: '⚠️ High Engine Load',
    description: 'Engine load above 75%',
    severity: SEVERITY.WARNING,
    check: (data) => data.load > 75 && data.load <= 90,
    threshold: 75,
    action: 'Monitor engine. Avoid prolonged high-load operation.'
  },

  MAF_SENSOR_FAULT: {
    id: 'maf_sensor_fault',
    name: '🌪️ MAF Sensor Issue',
    description: 'Abnormal MAF air flow reading',
    severity: SEVERITY.WARNING,
    check: (data) => {
      // MAF should gradually increase with RPM
      if (data.rpm > 3000 && data.maf < 5) return true;
      if (data.rpm > 5000 && data.maf < 15) return true;
      return false;
    },
    threshold: 'RPM-dependent',
    action: 'MAF sensor may need cleaning or replacement. Check for air leaks.'
  },

  THROTTLE_ISSUE: {
    id: 'throttle_issue',
    name: '🎚️ Throttle Anomaly',
    description: 'Throttle position abnormal for current speed',
    severity: SEVERITY.WARNING,
    check: (data) => {
      // High throttle but low speed = stuck throttle
      if (data.throttle > 80 && data.speed < 10 && data.rpm > 2000) return true;
      return false;
    },
    threshold: 'Dynamic',
    action: 'Check throttle cable, pedal sensor, or electronic throttle control.'
  },

  ENGINE_MISFIRE: {
    id: 'engine_misfire',
    name: '💥 Engine Misfire',
    description: 'Inconsistent RPM suggesting misfire',
    severity: SEVERITY.WARNING,
    check: (data) => {
      // Detect RPM variation
      return data.rpmVariation && data.rpmVariation > 500;
    },
    threshold: '>500 RPM variation',
    action: 'Check spark plugs, fuel injectors, ignition coils. May need tune-up.'
  },

  COOLANT_LOW: {
    id: 'coolant_low',
    name: '💧 Coolant Low',
    description: 'Engine temperature dropping below normal operating range',
    severity: SEVERITY.INFO,
    check: (data) => data.coolant < 50 && data.rpm > 1000,
    threshold: 50,
    action: 'Check coolant level and top up if needed. Inspect for leaks.'
  },

  RPM_IDLE_UNSTABLE: {
    id: 'rpm_idle_unstable',
    name: '⚙️ Unstable Idle',
    description: 'RPM fluctuating at idle',
    severity: SEVERITY.WARNING,
    check: (data) => {
      if (data.speed === 0 && data.rpm > 0 && data.rpmVariation > 300) return true;
      return false;
    },
    threshold: '>300 RPM variation at idle',
    action: 'Clean fuel injectors, check idle control valve, or inspect vacuum lines.'
  },

  FUEL_CONSUMPTION_HIGH: {
    id: 'fuel_consumption_high',
    name: '⛽ High Fuel Consumption',
    description: 'High MAF reading suggests poor fuel economy',
    severity: SEVERITY.INFO,
    check: (data) => {
      // High MAF + high load + low speed = inefficient operation
      if (data.maf > 50 && data.load > 70 && data.speed < 30) return true;
      return false;
    },
    threshold: 'MAF > 50, Load > 70%, Speed < 30 km/h',
    action: 'Reduce aggressive acceleration, check tire pressure, service engine.'
  },

  TRANSMISSION_ISSUE: {
    id: 'transmission_issue',
    name: '🔄 Transmission Issue',
    description: 'High RPM with low speed suggests transmission slip',
    severity: SEVERITY.WARNING,
    check: (data) => {
      // RPM way too high for the speed
      const expectedMaxRPM = data.speed * 300; // Rough estimate
      return data.rpm > expectedMaxRPM + 2000 && data.rpm > 3000;
    },
    threshold: 'RPM significantly higher than expected for speed',
    action: 'Transmission fluid may be low or burned. Check fluid level and condition.'
  },

  BATTERY_LOW: {
    id: 'battery_low',
    name: '🔋 Battery Low',
    description: 'System voltage indicating weak battery',
    severity: SEVERITY.WARNING,
    check: (data) => data.voltage && data.voltage < 12,
    threshold: '< 12V',
    action: 'Battery is weak. Get battery tested or replaced soon.'
  }
};

// ================= DATA TRACKING =================
let obd2DataHistory = {
  coolant: [],
  intake: [],
  rpm: [],
  speed: [],
  load: [],
  throttle: [],
  maf: [],
  maxPoints: 20
};

// ================= ADD DATA TO HISTORY =================
function trackOBDData(data) {
  Object.keys(obd2DataHistory).forEach(key => {
    if (data[key] !== undefined) {
      obd2DataHistory[key].push(data[key]);
      
      if (obd2DataHistory[key].length > obd2DataHistory.maxPoints) {
        obd2DataHistory[key].shift();
      }
    }
  });
}

// ================= CALCULATE RPM VARIATION =================
function calculateRPMVariation() {
  const rpmArray = obd2DataHistory.rpm;
  if (rpmArray.length < 5) return 0;
  
  const recent = rpmArray.slice(-5);
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  return max - min;
}

// ================= RUN DIAGNOSTICS =================
function runDiagnostics(obd2Data) {
  const currentProblems = [];
  
  // Track history
  trackOBDData(obd2Data);
  
  // Add variation metrics
  const dataWithMetrics = {
    ...obd2Data,
    rpmVariation: calculateRPMVariation()
  };

  // Check each problem definition
  Object.values(problemDefinitions).forEach(problemDef => {
    try {
      if (problemDef.check(dataWithMetrics)) {
        currentProblems.push(problemDef);
      }
    } catch (e) {
      console.error(`Error checking ${problemDef.id}:`, e);
    }
  });

  // Update problem display
  updateProblemsDisplay(currentProblems);
  
  // Log to history
  if (currentProblems.length > 0) {
    addToHistory(currentProblems, obd2Data);
  }

  return currentProblems;
}

// ================= UPDATE PROBLEMS DISPLAY =================
function updateProblemsDisplay(problems) {
  const container = document.getElementById('diagnosticsContainer');
  if (!container) return;

  diagnosticsDB.problems = problems;

  // Sort by severity (critical first)
  const sorted = problems.sort((a, b) => b.severity.level - a.severity.level);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="diagnostics-card health-perfect">
        <h3>✅ System Healthy</h3>
        <p>No problems detected. Vehicle is running normally.</p>
      </div>
    `;
    return;
  }

  let html = '';
  sorted.forEach(problem => {
    html += `
      <div class="diagnostics-card" style="border-left: 4px solid ${problem.severity.color}">
        <div class="problem-header">
          <h3>${problem.name}</h3>
          <span class="severity-badge" style="background-color: ${problem.severity.color}">
            ${problem.severity.label}
          </span>
        </div>
        <p class="problem-desc">${problem.description}</p>
        <div class="problem-details">
          <strong>Threshold:</strong> ${problem.threshold}<br>
          <strong>Action:</strong> ${problem.action}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ================= ADD TO HISTORY =================
function addToHistory(problems, obd2Data) {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  diagnosticsDB.history.push({
    timestamp,
    problems: problems.map(p => p.id),
    obd2Data: { ...obd2Data }
  });

  if (diagnosticsDB.history.length > diagnosticsDB.maxHistoryItems) {
    diagnosticsDB.history.shift();
  }
}

// ================= GET PROBLEM STATS =================
function getProblemStats() {
  const stats = {
    critical: diagnosticsDB.problems.filter(p => p.severity.level === 3).length,
    warning: diagnosticsDB.problems.filter(p => p.severity.level === 2).length,
    info: diagnosticsDB.problems.filter(p => p.severity.level === 1).length,
    total: diagnosticsDB.problems.length
  };
  return stats;
}

// ================= EXPORT FOR USE =================
window.AIdiagnostics = {
  runDiagnostics,
  getProblemStats,
  getHistory: () => diagnosticsDB.history,
  getProblems: () => diagnosticsDB.problems,
  clearHistory: () => { diagnosticsDB.history = []; }
};

console.log("✅ AI Diagnostics Engine ready");