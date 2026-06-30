'use strict';

// ─── FIREBASE CONFIGURATION ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAnL4GVFVoMy4oNnOSnxh14Jn_cdz5hIVY",
  authDomain: "mobilekhata-1b8a8.firebaseapp.com",
  projectId: "mobilekhata-1b8a8",
  storageBucket: "mobilekhata-1b8a8.firebasestorage.app",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
let confirmationResult = null;
let idToken = localStorage.getItem('admin_token') || null;
let currentTab = 'overview';
let activeShops = [];
let allShopsDropdown = []; // List of shops for ledger dropdown
let currentShopPage = 1;
let currentLedgerPage = 1;
let ledgerShopId = '';
let currentShopSortBy = 'created_at';
let currentShopSortOrder = 'DESC';
let activePlans = [];
let currentPremiumPage = 1;
let premiumSearchTimeout = null;
let revenueTrendChart = null;
let revenueDistributionChart = null;
let selectedPremiumShopId = null;
let currentFeedbackPage = 1;
let selectedFeedbackTicketId = null;

// ─── RUN ON LOAD ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();
  
  // Set up Firebase reCAPTCHA
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
    size: 'invisible',
    callback: (response) => {
      // reCAPTCHA solved
    }
  });

  // Set default values for Plan Analytics month & year dropdowns
  const now = new Date();
  const monthSelect = document.getElementById('analytics-month');
  const yearSelect = document.getElementById('analytics-year');
  if (monthSelect) monthSelect.value = now.getMonth() + 1;
  if (yearSelect) yearSelect.value = now.getFullYear();

  // Setup Event Listeners
  setupEventListeners();

  // Check authentication state
  checkAuthState();
});

// ─── AUTHENTICATION STATE CHECK ──────────────────────────────────────────
function checkAuthState() {
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      document.getElementById('admin-phone-display').textContent = user.phoneNumber || 'Admin';
      try {
        // Retrieve fresh ID token
        idToken = await user.getIdToken();
        localStorage.setItem('admin_token', idToken);
        
        // Quietly check admin access via stats endpoint
        const res = await fetch('/api/v2/admin/stats', {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (res.status === 403) {
          // Unauthorized Admin
          document.getElementById('user-uid').textContent = user.uid;
          document.getElementById('login-container').classList.remove('hidden');
          document.getElementById('dashboard-container').classList.add('hidden');
          showForm('unauth-view');
          showToast('Admin authorization required', 'error');
          hideLoadingScreen();
        } else if (res.ok) {
          // Access granted
          document.getElementById('login-container').classList.add('hidden');
          document.getElementById('dashboard-container').classList.remove('hidden');
          loadDashboardData();
          hideLoadingScreen();
        } else {
          // Other error (like 401 token invalid/expired, or 500)
          const errData = await res.json().catch(() => ({}));
          showToast('Access verification failed: ' + (errData.error || res.statusText || 'Unknown error'), 'error');
          handleLogout();
        }
      } catch (err) {
        showToast('Authentication error: ' + err.message, 'error');
        handleLogout();
      }
    } else {
      // Not logged in
      idToken = null;
      localStorage.removeItem('admin_token');
      document.getElementById('login-container').classList.remove('hidden');
      document.getElementById('dashboard-container').classList.add('hidden');
      showForm('phone-form');
      hideLoadingScreen();
    }
  });
}

function hideLoadingScreen() {
  const loader = document.getElementById('app-loading-container');
  if (loader && !loader.classList.contains('hidden')) {
    loader.style.opacity = '0';
    loader.style.visibility = 'hidden';
    setTimeout(() => {
      loader.classList.add('hidden');
    }, 350);
  }
}

function showForm(formId) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('unauth-view').classList.remove('active');
  
  if (formId === 'unauth-view') {
    document.getElementById('unauth-view').classList.add('active');
  } else {
    document.getElementById(formId).classList.add('active');
  }
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────
function setupEventListeners() {
  // Form submissions
  const phoneForm = document.getElementById('phone-form');
  if (phoneForm) phoneForm.addEventListener('submit', handleSendOTP);
  
  const otpForm = document.getElementById('otp-form');
  if (otpForm) otpForm.addEventListener('submit', handleVerifyOTP);
  
  // Back to phone number input
  const backToPhoneBtn = document.getElementById('back-to-phone-btn');
  if (backToPhoneBtn) {
    backToPhoneBtn.addEventListener('click', () => {
      showForm('phone-form');
    });
  }

  // Logout Buttons
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  
  const unauthLogoutBtn = document.getElementById('unauth-logout-btn');
  if (unauthLogoutBtn) unauthLogoutBtn.addEventListener('click', handleLogout);

  // Copy UID Button
  const copyUidBtn = document.getElementById('copy-uid-btn');
  if (copyUidBtn) {
    copyUidBtn.addEventListener('click', () => {
      const uid = document.getElementById('user-uid').textContent;
      navigator.clipboard.writeText(uid).then(() => {
        showToast('UID copied to clipboard!', 'info');
      });
    });
  }

  // Sidebar Menu Navigation
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Refresh Button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      showToast('Refreshing data...', 'info');
      loadDashboardData();
    });
  }

  // Shop Search Input
  let searchTimeout;
  const shopSearch = document.getElementById('shop-search');
  if (shopSearch) {
    shopSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentShopPage = 1;
        fetchShops();
      }, 400);
    });
  }

  // Ledger Shop Select dropdown
  const ledgerShopSelect = document.getElementById('ledger-shop-select');
  if (ledgerShopSelect) {
    ledgerShopSelect.addEventListener('change', (e) => {
      ledgerShopId = e.target.value;
      currentLedgerPage = 1;
      if (ledgerShopId) {
        document.getElementById('ledger-filters').classList.remove('hidden');
        document.getElementById('ledger-pagination').classList.remove('hidden');
        fetchTransactions();
      } else {
        document.getElementById('ledger-filters').classList.add('hidden');
        document.getElementById('ledger-pagination').classList.add('hidden');
        renderEmptyLedger();
      }
    });
  }

  // Ledger Filters
  const ledgerTypeFilter = document.getElementById('ledger-type-filter');
  if (ledgerTypeFilter) {
    ledgerTypeFilter.addEventListener('change', () => {
      currentLedgerPage = 1;
      fetchTransactions();
    });
  }

  // Modals close triggers
  const closeModalBtn = document.getElementById('close-modal-btn');
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  
  const cancelModalBtn = document.getElementById('cancel-modal-btn');
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeModal);
  
  const featuresForm = document.getElementById('features-form');
  if (featuresForm) featuresForm.addEventListener('submit', handleSaveFeatures);

  // Shop features fields toggling
  const shopAccountType = document.getElementById('shop-account-type');
  if (shopAccountType) {
    shopAccountType.addEventListener('change', (e) => {
      toggleFeaturesModalSections(e.target.value === 'premium');
    });
  }
  const premiumDurationPreset = document.getElementById('premium-duration-preset');
  if (premiumDurationPreset) {
    premiumDurationPreset.addEventListener('change', (e) => {
      handlePremiumDurationPreset(e.target.value);
    });
  }

  // Synchronize Free Days Limit and Free Trial Expiry Date
  const freeDaysLimitInput = document.getElementById('free-days-limit');
  const freeTrialExpiryDateInput = document.getElementById('free-trial-expiry-date');
  
  if (freeDaysLimitInput && freeTrialExpiryDateInput) {
    freeDaysLimitInput.addEventListener('input', (e) => {
      const days = parseInt(e.target.value, 10);
      if (isNaN(days) || days < 1) return;
      
      const shopId = document.getElementById('modal-shop-id').value;
      const shop = activeShops.find(s => s.id === shopId);
      if (!shop || !shop.created_at) return;
      
      const createdDate = new Date(shop.created_at);
      const expDate = new Date(createdDate.getTime());
      expDate.setDate(expDate.getDate() + days);
      const yyyy = expDate.getFullYear();
      const mm = String(expDate.getMonth() + 1).padStart(2, '0');
      const dd = String(expDate.getDate()).padStart(2, '0');
      freeTrialExpiryDateInput.value = `${yyyy}-${mm}-${dd}`;
    });
    
    freeTrialExpiryDateInput.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      
      const shopId = document.getElementById('modal-shop-id').value;
      const shop = activeShops.find(s => s.id === shopId);
      if (!shop || !shop.created_at) return;
      
      const selectedDate = new Date(val);
      const createdDate = new Date(shop.created_at);
      // Reset hours to midnight for accurate day calculation
      selectedDate.setHours(0, 0, 0, 0);
      createdDate.setHours(0, 0, 0, 0);
      
      const diffTime = selectedDate.getTime() - createdDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      freeDaysLimitInput.value = diffDays > 0 ? diffDays : 1;
    });
  }

  // Plan actions & triggers
  const addPlanBtn = document.getElementById('add-plan-btn');
  if (addPlanBtn) addPlanBtn.addEventListener('click', () => openAddPlanModal());
  
  const closePlanModalBtn = document.getElementById('close-plan-modal-btn');
  if (closePlanModalBtn) closePlanModalBtn.addEventListener('click', closePlanModal);
  
  const cancelPlanModalBtn = document.getElementById('cancel-plan-modal-btn');
  if (cancelPlanModalBtn) cancelPlanModalBtn.addEventListener('click', closePlanModal);
  
  const planForm = document.getElementById('plan-form');
  if (planForm) planForm.addEventListener('submit', handleSavePlan);

  // App Config Form
  const appConfigForm = document.getElementById('app-config-form');
  if (appConfigForm) {
    appConfigForm.addEventListener('submit', handleSaveAppConfig);
  }

  // Website Config Form
  const websiteConfigForm = document.getElementById('website-config-form');
  if (websiteConfigForm) {
    websiteConfigForm.addEventListener('submit', handleSaveWebsiteConfig);
  }

  // Plan Analytics Filter
  const analyticsFilterBtn = document.getElementById('analytics-filter-btn');
  if (analyticsFilterBtn) {
    analyticsFilterBtn.addEventListener('click', () => {
      fetchPlanAnalytics();
    });
  }

  // Push Notifications modal event handlers
  const sendBroadcastBtn = document.getElementById('send-broadcast-btn');
  if (sendBroadcastBtn) sendBroadcastBtn.addEventListener('click', () => openNotificationModal());
  
  const closeNotificationModalBtn = document.getElementById('close-notification-modal-btn');
  if (closeNotificationModalBtn) closeNotificationModalBtn.addEventListener('click', closeNotificationModal);
  
  const cancelNotificationBtn = document.getElementById('cancel-notification-btn');
  if (cancelNotificationBtn) cancelNotificationBtn.addEventListener('click', closeNotificationModal);
  
  const notificationForm = document.getElementById('notification-form');
  if (notificationForm) notificationForm.addEventListener('submit', handleSendNotification);

  // Maintenance Toggle
  const maintenanceSwitch = document.getElementById('maintenance-switch');
  if (maintenanceSwitch) maintenanceSwitch.addEventListener('change', handleToggleMaintenance);

  // Revenue tab controls
  const revFilterBtn = document.getElementById('revenue-filter-btn');
  if (revFilterBtn) {
    revFilterBtn.addEventListener('click', fetchRevenueDashboard);
  }
  const revExportBtn = document.getElementById('revenue-export-btn');
  if (revExportBtn) {
    revExportBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/v2/admin/revenue-dashboard/export', {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!res.ok) throw new Error('Failed to export CSV');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'revenue_report.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Premium customers directory controls
  const premSearch = document.getElementById('premium-search');
  if (premSearch) {
    premSearch.addEventListener('input', () => {
      clearTimeout(premiumSearchTimeout);
      premiumSearchTimeout = setTimeout(() => {
        currentPremiumPage = 1;
        fetchPremiumUsers();
      }, 400);
    });
  }
  const premFilterPlan = document.getElementById('premium-filter-plan');
  if (premFilterPlan) {
    premFilterPlan.addEventListener('change', () => {
      currentPremiumPage = 1;
      fetchPremiumUsers();
    });
  }
  const premFilterStatus = document.getElementById('premium-filter-status');
  if (premFilterStatus) {
    premFilterStatus.addEventListener('change', () => {
      currentPremiumPage = 1;
      fetchPremiumUsers();
    });
  }
  const premRefresh = document.getElementById('premium-refresh-btn');
  if (premRefresh) {
    premRefresh.addEventListener('click', fetchPremiumUsers);
  }

  // Premium User detail modal controls
  const closePmModalBtn = document.getElementById('close-premium-modal-btn');
  if (closePmModalBtn) {
    closePmModalBtn.addEventListener('click', closePremiumUserModal);
  }

  // Modal subtabs handlers
  document.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const subtab = btn.getAttribute('data-subtab');
      // Highlight btn
      document.querySelectorAll('.modal-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.color = 'var(--text-muted)';
        b.style.borderBottom = 'none';
      });
      btn.classList.add('active');
      btn.style.color = '#fff';
      btn.style.borderBottom = '2px solid var(--primary)';

      // Toggle panels
      document.querySelectorAll('.modal-tab-panel').forEach(p => {
        p.style.display = 'none';
      });
      document.getElementById(`subtab-${subtab}`).style.display = 'block';
    });
  });

  // PM notification form submit
  const pmNotifyForm = document.getElementById('pm-notify-form');
  if (pmNotifyForm) {
    pmNotifyForm.addEventListener('submit', handleSendPremiumNotification);
  }

  // Sortable headers click logic
  document.querySelectorAll('.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const field = header.getAttribute('data-sort');
      if (currentShopSortBy === field) {
        // Toggle order
        currentShopSortOrder = currentShopSortOrder === 'ASC' ? 'DESC' : 'ASC';
      } else {
        currentShopSortBy = field;
        currentShopSortOrder = 'ASC';
      }
      currentShopPage = 1;
      updateSortIndicators();
      fetchShops();
    });
  });
}

function updateSortIndicators() {
  const fields = ['shop_name', 'owner_name', 'phone_number', 'district', 'free_entries_used', 'created_at'];
  fields.forEach(field => {
    const el = document.getElementById(`sort-icon-${field}`);
    if (el) {
      if (currentShopSortBy === field) {
        el.textContent = currentShopSortOrder === 'ASC' ? '▲' : '▼';
      } else {
        el.textContent = '⇅';
      }
    }
  });
}

// ─── LOGIN FLOWS ──────────────────────────────────────────────────────────
async function handleSendOTP(e) {
  e.preventDefault();
  const phoneVal = document.getElementById('phone-input').value.trim();
  const formattedPhone = '+91' + phoneVal;

  const sendBtn = document.getElementById('send-otp-btn');
  sendBtn.disabled = true;
  sendBtn.querySelector('span').textContent = 'Sending OTP...';

  try {
    const appVerifier = window.recaptchaVerifier;
    confirmationResult = await auth.signInWithPhoneNumber(formattedPhone, appVerifier);
    showToast('OTP sent successfully!', 'success');
    showForm('otp-form');
  } catch (err) {
    showToast('Error sending OTP: ' + err.message, 'error');
    console.error(err);
    // Reset reCAPTCHA
    if (window.grecaptcha) {
      window.grecaptcha.reset(window.recaptchaWidgetId);
    }
  } finally {
    sendBtn.disabled = false;
    sendBtn.querySelector('span').textContent = 'Send Verification OTP';
  }
}

async function handleVerifyOTP(e) {
  e.preventDefault();
  const otpCode = document.getElementById('otp-input').value.trim();
  const verifyBtn = document.getElementById('verify-otp-btn');
  
  verifyBtn.disabled = true;
  verifyBtn.querySelector('span').textContent = 'Verifying...';

  try {
    // confirmationResult.confirm will sign the user in, triggering onAuthStateChanged
    await confirmationResult.confirm(otpCode);
  } catch (err) {
    showToast('Invalid OTP code. Please try again.', 'error');
    verifyBtn.disabled = false;
    verifyBtn.querySelector('span').textContent = 'Verify & Login';
  }
}

function handleLogout() {
  auth.signOut().then(() => {
    idToken = null;
    localStorage.removeItem('admin_token');
    document.getElementById('login-container').classList.remove('hidden');
    document.getElementById('dashboard-container').classList.add('hidden');
    document.getElementById('phone-input').value = '';
    document.getElementById('otp-input').value = '';
    showForm('phone-form');
    showToast('Logged out successfully', 'info');
    hideLoadingScreen();
  });
}

// ─── TAB NAVIGATION ───────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  
  // Highlight sidebar item
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-tab') === tab) {
      item.classList.add('active');
    }
  });

  // Switch panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`tab-${tab}`).classList.add('active');

  // Set Title
  const titles = {
    overview: { title: 'Dashboard Overview', sub: 'Platform-wide activity and aggregated metrics' },
    shops: { title: 'Shop Directory', sub: 'Manage registered shops, premium status and entries usage' },
    transactions: { title: 'Shop Ledger History', sub: 'Query transactional records and document attachments' },
    diagnostics: { title: 'System Diagnostics & Logs', sub: 'Inspect database health, sync operations, and raw server exception logs' },
    plans: { title: 'Premium Plans Directory', sub: 'Manage subscription packages, pricing, and billing SKU IDs shown inside the app' },
    'plan-analytics': { title: 'Subscription Plan Analytics', sub: 'Filter and view premium registrations, revenue, and popular packages' },
    revenue: { title: 'Revenue Dashboard', sub: 'Monitor platform revenue, plans breakdown, and trends' },
    'premium-users': { title: 'Premium Customers', sub: 'Manage premium users, payment history, and devices' },
    feedback: { title: 'Feedback & Improvement Center', sub: 'Manage user suggestions, bug reports, and responses' },
    config: { title: 'App Configuration', sub: 'Manage global platform configuration synced to mobile apps' },
    website: { title: 'Website Content', sub: 'Manage public landing page content' }
  };

  document.getElementById('page-title').textContent = titles[tab]?.title || 'Admin Portal';
  document.getElementById('page-subtitle').textContent = titles[tab]?.sub || '';

  if (tab === 'diagnostics') {
    fetchDiagnostics();
    fetchMaintenanceStatus();
  } else if (tab === 'plans') {
    fetchPlansAdmin();
  } else if (tab === 'plan-analytics') {
    fetchPlanAnalytics();
  } else if (tab === 'revenue') {
    fetchRevenueDashboard();
  } else if (tab === 'premium-users') {
    fetchPremiumUsers();
  } else if (tab === 'feedback') {
    loadFeedbackStats();
    loadFeedbackList();
  } else if (tab === 'config' || tab === 'website') {
    loadAppConfig();
  }
}

// ─── LOAD DATA WRAPPERS ───────────────────────────────────────────────────
function loadDashboardData() {
  fetchStats();
  fetchShops();
  fetchAllShopsForDropdown();
  if (currentTab === 'diagnostics') {
    fetchDiagnostics();
    fetchMaintenanceStatus();
  } else if (currentTab === 'plans') {
    fetchPlansAdmin();
  } else if (currentTab === 'revenue') {
    fetchRevenueDashboard();
  } else if (currentTab === 'premium-users') {
    fetchPremiumUsers();
  } else if (currentTab === 'feedback') {
    loadFeedbackStats();
    loadFeedbackList();
  } else if (currentTab === 'config' || currentTab === 'website') {
    loadAppConfig();
  }
}

// ─── API: FETCH STATS ─────────────────────────────────────────────────────
async function fetchStats() {
  const breakdownList = document.getElementById('txn-breakdown-list');
  breakdownList.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading breakdown...</p></div>`;

  try {
    const res = await fetch('/api/v2/admin/stats', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to fetch statistics');

    const data = await res.json();
    const stats = data.data;

    // Render Stats Cards
    document.getElementById('stat-shops').textContent = stats.totalShops || 0;
    document.getElementById('stat-customers').textContent = stats.totalCustomers || 0;
    document.getElementById('stat-stock').textContent = stats.totalStock || 0;

    let totalTxns = 0;
    let purchaseTotal = 0;
    let purchaseCount = 0;
    let saleTotal = 0;
    let saleCount = 0;
    let repairCount = 0;

    stats.transactions.forEach(t => {
      const count = parseInt(t.count, 10);
      totalTxns += count;

      if (t.txn_type === 'Purchase') {
        purchaseCount = count;
        purchaseTotal = parseInt(t.total_amount, 10);
      } else if (t.txn_type === 'Sale') {
        saleCount = count;
        saleTotal = parseInt(t.total_amount, 10);
      } else if (t.txn_type === 'Repair') {
        repairCount = count;
      }
    });

    document.getElementById('stat-transactions').textContent = totalTxns;

    // Render Breakdown
    breakdownList.innerHTML = `
      <div class="breakdown-item">
        <div class="breakdown-info">
          <div class="breakdown-icon green">
            <i data-lucide="arrow-down-left"></i>
          </div>
          <div>
            <div class="breakdown-name">Purchase Entries</div>
            <div class="breakdown-count">${purchaseCount} devices bought</div>
          </div>
        </div>
        <div class="breakdown-amount">₹${purchaseTotal.toLocaleString('en-IN')}</div>
      </div>

      <div class="breakdown-item">
        <div class="breakdown-info">
          <div class="breakdown-icon orange">
            <i data-lucide="arrow-up-right"></i>
          </div>
          <div>
            <div class="breakdown-name">Sale Entries</div>
            <div class="breakdown-count">${saleCount} devices sold</div>
          </div>
        </div>
        <div class="breakdown-amount">₹${saleTotal.toLocaleString('en-IN')}</div>
      </div>

      <div class="breakdown-item">
        <div class="breakdown-info">
          <div class="breakdown-icon red">
            <i data-lucide="wrench"></i>
          </div>
          <div>
            <div class="breakdown-name">Repair Entries</div>
            <div class="breakdown-count">${repairCount} repair logs</div>
          </div>
        </div>
        <div class="breakdown-amount">-</div>
      </div>
    `;
    lucide.createIcons();

  } catch (err) {
    showToast(err.message, 'error');
    breakdownList.innerHTML = `<p class="text-center text-muted py-3">Error loading stats</p>`;
  }
}

// ─── API: FETCH SHOPS LIST ────────────────────────────────────────────────
async function fetchShops() {
  const tableBody = document.getElementById('shops-table-body');
  const pagination = document.getElementById('shops-pagination');
  
  // Render Shimmer Loading (8 columns)
  tableBody.innerHTML = Array(5).fill().map(() => `
    <tr class="shimmer-row">
      <td><div class="shimmer-line"></div></td>
      <td><div class="shimmer-line short"></div></td>
      <td><div class="shimmer-line medium"></div></td>
      <td><div class="shimmer-line short"></div></td>
      <td><div class="shimmer-line"></div></td>
      <td><div class="shimmer-line short"></div></td>
      <td><div class="shimmer-line short"></div></td>
      <td><div class="shimmer-line short"></div></td>
    </tr>
  `).join('');

  updateSortIndicators();

  const searchVal = document.getElementById('shop-search').value.trim();
  const url = `/api/v2/admin/shops?page=${currentShopPage}&limit=10&search=${encodeURIComponent(searchVal)}&sortBy=${currentShopSortBy}&sortOrder=${currentShopSortOrder}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to load shop directory');

    const result = await res.json();
    const shops = result.data;
    const paginationMeta = result.meta || {};

    activeShops = shops; // store globally for modal bindings

    if (shops.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-muted py-5">
            <i data-lucide="store-off" class="large-icon mb-2"></i>
            <p>No shops found matching filters</p>
          </td>
        </tr>
      `;
      pagination.innerHTML = '';
      lucide.createIcons();
      return;
    }

    // Render Table Rows
    tableBody.innerHTML = shops.map(shop => {
      const featBadges = [];
      if (shop.canSell) featBadges.push('<span class="badge badge-feature active">Purchase</span>');
      if (shop.canPurchase) featBadges.push('<span class="badge badge-feature active">Sale</span>');
      if (shop.canRepair) featBadges.push('<span class="badge badge-feature active">Repair</span>');
      if (shop.canReports) featBadges.push('<span class="badge badge-feature active">Reports</span>');
      
      if (featBadges.length === 0) {
        featBadges.push('<span class="badge badge-feature">All Locked</span>');
      }

      const regDate = shop.created_at ? new Date(shop.created_at).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      }) : 'N/A';

      return `
        <tr>
          <td><strong>${escapeHtml(shop.shop_name)}</strong></td>
          <td>${escapeHtml(shop.owner_name || 'N/A')}</td>
          <td><code>${escapeHtml(shop.phone_number)}</code></td>
          <td>${escapeHtml(shop.district || 'N/A')}</td>
          <td><div class="flex-center">${featBadges.join('')}</div></td>
          <td><code>${shop.freeEntriesUsed} / ${shop.freeEntriesLimit}</code> entries</td>
          <td><code>${escapeHtml(regDate)}</code></td>
          <td>
            <div class="actions-cell">
              <button class="btn-action" onclick="openFeaturesModal('${shop.id}')" title="Modify Permissions">
                <i data-lucide="sliders"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();

    // Render Pagination Controls
    const totalPages = paginationMeta.totalPages || 1;
    pagination.innerHTML = `
      <div class="page-info">Showing page ${currentShopPage} of ${totalPages} (Total ${paginationMeta.total || 0} shops)</div>
      <div class="page-buttons">
        <button class="btn-page" ${currentShopPage === 1 ? 'disabled' : ''} onclick="changeShopPage(${currentShopPage - 1})">Prev</button>
        <button class="btn-page" ${currentShopPage === totalPages ? 'disabled' : ''} onclick="changeShopPage(${currentShopPage + 1})">Next</button>
      </div>
    `;

  } catch (err) {
    showToast(err.message, 'error');
    tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">Error loading shops</td></tr>`;
    pagination.innerHTML = '';
  }
}

window.changeShopPage = function(page) {
  currentShopPage = page;
  fetchShops();
};

// ─── API: FETCH ALL SHOPS FOR LEDGER DROPDOWN ────────────────────────────
async function fetchAllShopsForDropdown() {
  const selectDropdown = document.getElementById('ledger-shop-select');
  
  try {
    const res = await fetch('/api/v2/admin/shops?page=1&limit=500', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (!res.ok) return;

    const result = await res.json();
    allShopsDropdown = result.data;

    // Reset dropdown keep first choice
    selectDropdown.innerHTML = '<option value="">-- Choose a Shop --</option>';
    allShopsDropdown.forEach(shop => {
      const option = document.createElement('option');
      option.value = shop.id;
      option.textContent = `${shop.shop_name} (${shop.owner_name || 'N/A'} - ${shop.phone_number})`;
      selectDropdown.appendChild(option);
    });

  } catch (err) {
    console.error('Failed to pre-fetch shops list for ledger', err);
  }
}

// ─── API: FETCH TRANSACTIONS LEDGER FOR SHOP ──────────────────────────────
async function fetchTransactions() {
  const tableBody = document.getElementById('transactions-table-body');
  const pagination = document.getElementById('ledger-pagination');
  
  if (!ledgerShopId) return;

  // Shimmer states
  tableBody.innerHTML = Array(5).fill().map(() => `
    <tr class="shimmer-row">
      <td><div class="shimmer-line"></div></td>
      <td><div class="shimmer-line short"></div></td>
      <td><div class="shimmer-line"></div></td>
      <td><div class="shimmer-line"></div></td>
      <td><div class="shimmer-line"></div></td>
      <td><div class="shimmer-line short"></div></td>
      <td><div class="shimmer-line short"></div></td>
      <td><div class="shimmer-line"></div></td>
    </tr>
  `).join('');

  const typeFilter = document.getElementById('ledger-type-filter').value;
  let url = `/api/v2/admin/shops/${ledgerShopId}/transactions?page=${currentLedgerPage}&limit=15`;
  if (typeFilter) {
    url += `&type=${typeFilter}`;
  }

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to load transaction history');

    const result = await res.json();
    const txns = result.data;
    const paginationMeta = result.meta || {};

    if (txns.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-muted py-5">
            <i data-lucide="clipboard-x" class="large-icon mb-2"></i>
            <p>No transactions registered for this shop.</p>
          </td>
        </tr>
      `;
      pagination.innerHTML = '';
      lucide.createIcons();
      return;
    }

    // Render rows
    tableBody.innerHTML = txns.map(t => {
      const typeBadgeClass = t.txn_type === 'Purchase' ? 'badge-success' : (t.txn_type === 'Sale' ? 'badge-info' : 'badge-warning');
      const formattedDate = new Date(t.txn_date).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      return `
        <tr>
          <td><code>${formattedDate}</code></td>
          <td><span class="badge ${typeBadgeClass}">${t.txn_type}</span></td>
          <td>
            <strong>${escapeHtml(t.brand)} ${escapeHtml(t.model)}</strong>
            <div class="text-muted" style="font-size: 0.75rem">${escapeHtml(t.color)} • ${escapeHtml(t.storage)}</div>
          </td>
          <td><code>${escapeHtml(t.imei1)}</code></td>
          <td>
            ${escapeHtml(t.customer_name)}
            <div class="text-muted" style="font-size: 0.75rem">${escapeHtml(t.customer_mobile)}</div>
          </td>
          <td><span class="badge badge-feature">${escapeHtml(t.payment_method)}</span></td>
          <td><strong>₹${t.amount.toLocaleString('en-IN')}</strong></td>
          <td class="text-muted" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(t.remarks || '')}">
            ${escapeHtml(t.remarks || '-')}
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();

    const totalPages = paginationMeta.totalPages || 1;
    pagination.innerHTML = `
      <div class="page-info">Showing page ${currentLedgerPage} of ${totalPages} (Total ${paginationMeta.total || 0} entries)</div>
      <div class="page-buttons">
        <button class="btn-page" ${currentLedgerPage === 1 ? 'disabled' : ''} onclick="changeLedgerPage(${currentLedgerPage - 1})">Prev</button>
        <button class="btn-page" ${currentLedgerPage === totalPages ? 'disabled' : ''} onclick="changeLedgerPage(${currentLedgerPage + 1})">Next</button>
      </div>
    `;

  } catch (err) {
    showToast(err.message, 'error');
    tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">Error loading transactions</td></tr>`;
    pagination.innerHTML = '';
  }
}

window.changeLedgerPage = function(page) {
  currentLedgerPage = page;
  fetchTransactions();
};

function renderEmptyLedger() {
  document.getElementById('transactions-table-body').innerHTML = `
    <tr>
      <td colspan="8" class="text-center text-muted py-5">
        <i data-lucide="store" class="large-icon mb-2"></i>
        <p>Select a shop from the dropdown above to load transaction ledger</p>
      </td>
    </tr>
  `;
  document.getElementById('ledger-pagination').innerHTML = '';
  lucide.createIcons();
}

// ─── FEATURES FLAG DETAILS MODAL ─────────────────────────────────────────
async function fetchActivePlansForSelect() {
  const selectPreset = document.getElementById('premium-duration-preset');
  if (!selectPreset) return;

  try {
    if (!window.activePlans || window.activePlans.length === 0) {
      const res = await fetch('/api/v2/admin/plans', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok) {
        const result = await res.json();
        window.activePlans = result.data || [];
      }
    }

    selectPreset.innerHTML = '<option value="">-- Choose a Plan --</option>';
    
    const activeOnes = (window.activePlans || []).filter(p => p.is_active);
    activeOnes.forEach(plan => {
      const option = document.createElement('option');
      option.value = plan.id;
      option.textContent = `${plan.name} (${plan.currency}${plan.price})`;
      selectPreset.appendChild(option);
    });

    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom Expiry Date';
    selectPreset.appendChild(customOpt);

  } catch (err) {
    console.error('Failed to load plans for features dropdown', err);
  }
}

function toggleFeaturesModalSections(isPremium) {
  const premiumSec = document.getElementById('premium-options-section');
  const freeSec = document.getElementById('free-options-section');
  if (isPremium) {
    premiumSec.classList.remove('hidden');
    freeSec.classList.add('hidden');
  } else {
    premiumSec.classList.add('hidden');
    freeSec.classList.remove('hidden');
  }
}

function handlePremiumDurationPreset(preset) {
  const expiryInput = document.getElementById('premium-expiry-date');
  const expiryGroup = document.getElementById('custom-expiry-date-group');
  
  if (!preset) {
    expiryInput.value = '';
    return;
  }

  if (preset === 'custom') {
    expiryGroup.classList.remove('hidden');
    expiryInput.value = '';
    return;
  }
  
  expiryGroup.classList.add('hidden');
  
  const plan = (window.activePlans || []).find(p => p.id === preset);
  if (!plan) return;

  const date = new Date();
  const duration = parseInt(plan.duration, 10);
  const unit = (plan.unit || 'months').toLowerCase();

  if (unit === 'months') {
    date.setMonth(date.getMonth() + duration);
  } else if (unit === 'days') {
    date.setDate(date.getDate() + duration);
  } else if (unit === 'years') {
    date.setFullYear(date.getFullYear() + duration);
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  expiryInput.value = `${yyyy}-${mm}-${dd}`;
}

window.openFeaturesModal = async function(shopId) {
  const shop = activeShops.find(s => s.id === shopId);
  if (!shop) return;

  await fetchActivePlansForSelect();

  // Set modal details
  document.getElementById('modal-shop-name').textContent = shop.shop_name;
  document.getElementById('modal-shop-owner').textContent = `${shop.owner_name || 'N/A'} • ${shop.phone_number}`;
  document.getElementById('modal-shop-id').value = shop.id;

  // Determine if currently Premium or Free
  const isPremium = shop.premiumExpiresAt && (new Date(shop.premiumExpiresAt) > new Date());
  document.getElementById('shop-account-type').value = isPremium ? 'premium' : 'free';

  // Toggle sections
  toggleFeaturesModalSections(isPremium);

  // Set dates and presets
  const expiryInput = document.getElementById('premium-expiry-date');
  if (shop.premiumExpiresAt) {
    const expDate = new Date(shop.premiumExpiresAt);
    const yyyy = expDate.getFullYear();
    const mm = String(expDate.getMonth() + 1).padStart(2, '0');
    const dd = String(expDate.getDate()).padStart(2, '0');
    expiryInput.value = `${yyyy}-${mm}-${dd}`;
  } else {
    expiryInput.value = '';
  }
  document.getElementById('premium-duration-preset').value = 'custom';
  document.getElementById('custom-expiry-date-group').classList.remove('hidden');

  // Set limits
  document.getElementById('limit-entries').value = shop.freeEntriesLimit || 10;
  document.getElementById('used-entries').value = shop.freeEntriesUsed || 0;
  const freeDays = shop.freeDaysLimit || 30;
  document.getElementById('free-days-limit').value = freeDays;

  // Calculate and set Free Trial Expiration Date picker
  if (shop.created_at) {
    const createdDate = new Date(shop.created_at);
    const expDate = new Date(createdDate.getTime());
    expDate.setDate(expDate.getDate() + freeDays);
    const yyyy = expDate.getFullYear();
    const mm = String(expDate.getMonth() + 1).padStart(2, '0');
    const dd = String(expDate.getDate()).padStart(2, '0');
    document.getElementById('free-trial-expiry-date').value = `${yyyy}-${mm}-${dd}`;
  } else {
    document.getElementById('free-trial-expiry-date').value = '';
  }

  // Display Modal
  document.getElementById('features-modal').classList.add('active');
};

function closeModal() {
  document.getElementById('features-modal').classList.remove('active');
  document.getElementById('features-form').reset();
}

async function handleSaveFeatures(e) {
  e.preventDefault();
  
  const shopId = document.getElementById('modal-shop-id').value;
  const saveBtn = document.getElementById('save-features-btn');
  const accountType = document.getElementById('shop-account-type').value;

  let premiumExpiresAt = null;
  let freeDaysLimit = 30;
  let freeEntriesLimit = 10;
  let freeEntriesUsed = 0;
  let planId = null;

  if (accountType === 'premium') {
    const expiryVal = document.getElementById('premium-expiry-date').value;
    if (!expiryVal) {
      showToast('Please select a premium expiration date', 'error');
      return;
    }
    premiumExpiresAt = new Date(expiryVal).toISOString();
    planId = document.getElementById('premium-duration-preset').value;
  } else {
    freeDaysLimit = parseInt(document.getElementById('free-days-limit').value, 10);
    freeEntriesLimit = parseInt(document.getElementById('limit-entries').value, 10);
    freeEntriesUsed = parseInt(document.getElementById('used-entries').value, 10);
  }

  saveBtn.disabled = true;
  saveBtn.querySelector('span').textContent = 'Saving...';

  try {
    const res = await fetch(`/api/v2/admin/shops/${shopId}/features`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        canSell: accountType === 'premium',
        canPurchase: accountType === 'premium',
        canRepair: accountType === 'premium',
        canReports: accountType === 'premium',
        freeEntriesLimit,
        freeEntriesUsed,
        premiumExpiresAt,
        freeDaysLimit,
        planId
      })
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to update shop privileges');

    showToast('Shop configurations saved!', 'success');
    closeModal();
    
    // Refresh tables
    fetchShops();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.querySelector('span').textContent = 'Save Settings';
  }
}

// ─── PREMIUM PLANS CRUD CONTROLLERS ──────────────────────────────────────
async function fetchPlansAdmin() {
  const tableBody = document.getElementById('plans-table-body');
  if (!tableBody) return;
  tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-5"><div class="spinner"></div><p>Loading plans...</p></td></tr>`;

  try {
    const res = await fetch('/api/v2/admin/plans', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to load plans');

    const result = await res.json();
    activePlans = result.data || [];

    if (activePlans.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center text-muted py-5">
            <i data-lucide="credit-card" class="large-icon mb-2"></i>
            <p>No premium plans defined yet.</p>
          </td>
        </tr>
      `;
      lucide.createIcons();
      return;
    }

    tableBody.innerHTML = activePlans.map(p => {
      return `
        <tr>
          <td><code>${escapeHtml(p.id)}</code></td>
          <td><code>${escapeHtml(p.sku_id)}</code></td>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td>${escapeHtml(p.name_hi || '-')}</td>
          <td>${escapeHtml(p.name_gu || '-')}</td>
          <td><strong>${escapeHtml(p.currency)}${p.price}</strong></td>
          <td>${p.duration} ${escapeHtml(p.unit)}</td>
          <td>
            <span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">
              ${p.is_active ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td>
            <span class="badge ${p.popular ? 'badge-info' : 'badge-feature'}">
              ${p.popular ? 'Yes' : 'No'}
            </span>
          </td>
          <td>
            <div class="actions-cell">
              <button class="btn-action" onclick="openEditPlanModal('${p.id}')" title="Edit Plan">
                <i data-lucide="edit-3"></i>
              </button>
              <button class="btn-action btn-delete" onclick="handleDeletePlan('${p.id}')" title="Delete Plan" style="color: var(--danger); margin-left: 5px;">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
    lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
    tableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-3">Error loading plans</td></tr>`;
  }
}

function openAddPlanModal() {
  document.getElementById('plan-modal-title').textContent = 'Add Premium Plan';
  document.getElementById('plan-form').reset();
  document.getElementById('plan-id').readOnly = false;
  document.getElementById('plan-active').checked = true;
  document.getElementById('plan-modal').classList.add('active');
}

window.openEditPlanModal = function(planId) {
  const plan = activePlans.find(p => p.id === planId);
  if (!plan) return;
  
  document.getElementById('plan-modal-title').textContent = 'Edit Premium Plan';
  document.getElementById('plan-id').value = plan.id;
  document.getElementById('plan-id').readOnly = true;
  document.getElementById('plan-sku').value = plan.sku_id;
  document.getElementById('plan-name').value = plan.name;
  document.getElementById('plan-name-hi').value = plan.name_hi || '';
  document.getElementById('plan-name-gu').value = plan.name_gu || '';
  document.getElementById('plan-price').value = plan.price;
  document.getElementById('plan-currency').value = plan.currency;
  document.getElementById('plan-duration').value = plan.duration;
  document.getElementById('plan-unit').value = plan.unit || 'months';
  document.getElementById('plan-popular').checked = !!plan.popular;
  document.getElementById('plan-active').checked = !!plan.is_active;

  document.getElementById('plan-modal').classList.add('active');
}

function closePlanModal() {
  document.getElementById('plan-modal').classList.remove('active');
  document.getElementById('plan-form').reset();
}

async function handleSavePlan(e) {
  e.preventDefault();
  
  const saveBtn = document.getElementById('save-plan-btn-submit');
  const payload = {
    id: document.getElementById('plan-id').value.trim(),
    skuId: document.getElementById('plan-sku').value.trim(),
    name: document.getElementById('plan-name').value.trim(),
    nameHi: document.getElementById('plan-name-hi').value.trim(),
    nameGu: document.getElementById('plan-name-gu').value.trim(),
    price: parseInt(document.getElementById('plan-price').value, 10),
    currency: document.getElementById('plan-currency').value.trim(),
    duration: parseInt(document.getElementById('plan-duration').value, 10),
    unit: document.getElementById('plan-unit').value,
    popular: document.getElementById('plan-popular').checked,
    isActive: document.getElementById('plan-active').checked
  };

  saveBtn.disabled = true;
  saveBtn.querySelector('span').textContent = 'Saving...';

  try {
    const res = await fetch('/api/v2/admin/plans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to save plan');

    showToast('Premium plan saved successfully!', 'success');
    closePlanModal();
    fetchPlansAdmin();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.querySelector('span').textContent = 'Save Plan';
  }
}

window.handleDeletePlan = async function(planId) {
  if (!confirm(`Are you sure you want to delete plan "${planId}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/v2/admin/plans/${planId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to delete plan');

    showToast('Plan deleted successfully', 'success');
    fetchPlansAdmin();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── TOAST MESSAGES HELPER ───────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'info';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'alert-triangle';

  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span class="toast-text">${escapeHtml(message)}</span>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();

  // Slide out and remove
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// ─── UNAUTHORIZED ERRORS HANDLER ─────────────────────────────────────────
function handleUnauthorizedError() {
  showToast('Session expired or access denied', 'error');
  handleLogout();
}

// Helper to escape HTML tags to avoid XSS injections
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── API: FETCH DIAGNOSTICS & SYSTEM LOGS ──────────────────────────────
async function fetchDiagnostics() {
  const dbLatencyEl = document.getElementById('diag-db-latency');
  const storageFilesEl = document.getElementById('diag-storage-files');
  const syncConflictsEl = document.getElementById('diag-sync-conflicts');
  const syncTotalEl = document.getElementById('diag-sync-total');
  
  const errorLogsEl = document.getElementById('error-logs-terminal');
  const combinedLogsEl = document.getElementById('combined-logs-terminal');

  dbLatencyEl.textContent = 'Checking...';
  storageFilesEl.textContent = 'Checking...';
  syncConflictsEl.textContent = 'Checking...';
  syncTotalEl.textContent = 'Checking...';
  
  errorLogsEl.textContent = 'Fetching logs from server...';
  combinedLogsEl.textContent = 'Fetching logs from server...';

  try {
    const res = await fetch('/api/v2/admin/diagnostics', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to fetch diagnostics reports');

    const result = await res.json();
    const diag = result.data;

    // Render Stats
    dbLatencyEl.textContent = `${diag.health.dbLatencyMs} ms`;
    storageFilesEl.textContent = diag.health.storage.error ? 'Error' : `${diag.health.storage.fileCount} files`;
    syncConflictsEl.textContent = diag.health.syncMetrics.failedLast24h + diag.health.syncMetrics.conflictLast24h;
    syncTotalEl.textContent = diag.health.syncMetrics.totalLast24h;

    // Render Logs
    errorLogsEl.textContent = diag.logs.error || '[Empty error log]';
    combinedLogsEl.textContent = diag.logs.combined || '[Empty combined log]';

    // Auto scroll logs to bottom
    errorLogsEl.scrollTop = errorLogsEl.scrollHeight;
    combinedLogsEl.scrollTop = combinedLogsEl.scrollHeight;

  } catch (err) {
    showToast(err.message, 'error');
    dbLatencyEl.textContent = 'Error';
    storageFilesEl.textContent = 'Error';
    syncConflictsEl.textContent = 'Error';
    syncTotalEl.textContent = 'Error';
    
    errorLogsEl.textContent = `Error: ${err.message}`;
    combinedLogsEl.textContent = `Error: ${err.message}`;
  }
}

// ─── API: FETCH GLOBAL MAINTENANCE STATUS ───────────────────────────────
async function fetchMaintenanceStatus() {
  const mSwitch = document.getElementById('maintenance-switch');
  const mBadge = document.getElementById('maintenance-badge');
  if (!mSwitch || !mBadge) return;

  try {
    const maintRes = await fetch('/api/v2/admin/maintenance', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (maintRes.ok) {
      const maintData = await maintRes.json();
      const isActive = maintData.data.maintenanceMode;
      
      mSwitch.checked = isActive;
      if (isActive) {
        mBadge.textContent = 'ACTIVE';
        mBadge.className = 'badge badge-danger';
      } else {
        mBadge.textContent = 'INACTIVE';
        mBadge.className = 'badge badge-success';
      }
    }
  } catch (err) {
    console.error('Failed to load maintenance status', err);
  }
}

// ─── API: TOGGLE GLOBAL MAINTENANCE MODE ───────────────────────────────
async function handleToggleMaintenance(e) {
  const isChecked = e.target.checked;
  const badge = document.getElementById('maintenance-badge');

  try {
    const res = await fetch('/api/v2/admin/maintenance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ maintenanceMode: isChecked })
    });

    if (res.status === 401 || res.status === 403) {
      e.target.checked = !isChecked; // revert switch state
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to update maintenance settings');

    // Update UI badge
    if (isChecked) {
      badge.textContent = 'ACTIVE';
      badge.className = 'badge badge-danger';
      showToast('Maintenance Mode is now ON!', 'success');
    } else {
      badge.textContent = 'INACTIVE';
      badge.className = 'badge badge-success';
      showToast('Maintenance Mode is now OFF!', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
    e.target.checked = !isChecked; // revert
  }
}

// ─── API: FETCH APP CONFIG ────────────────────────────────────────────────
async function loadAppConfig() {
  try {
    const res = await fetch('/api/v2/admin/config', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to load app config');

    const result = await res.json();
    const config = result.data;
    
    document.getElementById('config-support-whatsapp').value = config.support_whatsapp || '';
    document.getElementById('config-support-email').value = config.support_email || '';
    document.getElementById('config-privacy-policy').value = config.privacy_policy_url || '';
    document.getElementById('config-min-app-version').value = config.min_app_version_code || '3';
    document.getElementById('config-app-update-url').value = config.app_update_url || '';
    
    // Website Config fields
    if (document.getElementById('config-website-hero-title')) {
      document.getElementById('config-website-hero-title').value = config.website_hero_title || '';
      document.getElementById('config-website-hero-subtitle').value = config.website_hero_subtitle || '';
      document.getElementById('config-website-about-text').value = config.website_about_text || '';
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── API: SAVE APP CONFIG ────────────────────────────────────────────────
async function handleSaveAppConfig(e) {
  e.preventDefault();
  
  const saveBtn = document.getElementById('save-config-btn');
  saveBtn.disabled = true;
  saveBtn.querySelector('span').textContent = 'Saving...';

  const configToSave = [
    { key: 'support_whatsapp', value: document.getElementById('config-support-whatsapp').value },
    { key: 'support_email', value: document.getElementById('config-support-email').value },
    { key: 'privacy_policy_url', value: document.getElementById('config-privacy-policy').value },
    { key: 'min_app_version_code', value: document.getElementById('config-min-app-version').value },
    { key: 'app_update_url', value: document.getElementById('config-app-update-url').value }
  ];

  try {
    for (const item of configToSave) {
      const res = await fetch('/api/v2/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(item)
      });
      
      if (res.status === 401 || res.status === 403) {
        handleUnauthorizedError();
        return;
      }
      if (!res.ok) throw new Error('Failed to save ' + item.key);
    }
    showToast('App configuration updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.querySelector('span').textContent = 'Save Configuration';
  }
}

// ─── API: SAVE WEBSITE CONFIG ──────────────────────────────────────────────
async function handleSaveWebsiteConfig(e) {
  e.preventDefault();
  
  const saveBtn = document.getElementById('save-website-btn');
  saveBtn.disabled = true;
  saveBtn.querySelector('span').textContent = 'Saving...';

  const configToSave = [
    { key: 'website_hero_title', value: document.getElementById('config-website-hero-title').value },
    { key: 'website_hero_subtitle', value: document.getElementById('config-website-hero-subtitle').value },
    { key: 'website_about_text', value: document.getElementById('config-website-about-text').value }
  ];

  try {
    for (const item of configToSave) {
      const res = await fetch('/api/v2/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(item)
      });
      
      if (res.status === 401 || res.status === 403) {
        handleUnauthorizedError();
        return;
      }
      if (!res.ok) throw new Error('Failed to save ' + item.key);
    }
    showToast('Website content updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.querySelector('span').textContent = 'Save Website Content';
  }
}

// ─── PUSH NOTIFICATION MODAL & SENDING ──────────────────────────────────
function openNotificationModal(targetShopId = 'all') {
  const modal = document.getElementById('notification-modal');
  const targetSelect = document.getElementById('notification-target');
  
  if (!modal || !targetSelect) return;
  
  targetSelect.innerHTML = '<option value="all">All Active Shops (Broadcast)</option>';
  
  const list = window.allShopsDropdown || [];
  list.forEach(shop => {
    const opt = document.createElement('option');
    opt.value = shop.id;
    opt.textContent = `${shop.shop_name} (${shop.owner_name || 'N/A'})`;
    targetSelect.appendChild(opt);
  });
  
  targetSelect.value = targetShopId;
  modal.classList.add('active');
  lucide.createIcons();
}

function closeNotificationModal() {
  document.getElementById('notification-modal').classList.remove('active');
  document.getElementById('notification-form').reset();
}

async function handleSendNotification(e) {
  e.preventDefault();
  
  const targetVal = document.getElementById('notification-target').value;
  const titleVal = document.getElementById('notification-title').value.trim();
  const bodyVal = document.getElementById('notification-body').value.trim();
  const sendBtn = document.getElementById('send-notification-submit-btn');

  if (!titleVal || !bodyVal) {
    showToast('Title and message body are required', 'error');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.querySelector('span').textContent = 'Sending...';

  try {
    const res = await fetch('/api/v2/admin/notifications/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        title: titleVal,
        body: bodyVal,
        shopId: targetVal
      })
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to send notification');

    showToast(`Notification sent successfully!`, 'success');
    closeNotificationModal();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.querySelector('span').textContent = 'Send Alert';
  }
}

// ─── API: PLAN ANALYTICS ──────────────────────────────────────────────────
async function fetchPlanAnalytics() {
  const month = document.getElementById('analytics-month').value;
  const year = document.getElementById('analytics-year').value;
  const tableBody = document.getElementById('analytics-table-body');
  const popularityList = document.getElementById('analytics-popularity-list');
  
  if (!tableBody || !popularityList) return;
  
  tableBody.innerHTML = `
    <tr>
      <td colspan="7" class="text-center py-5">
        <div class="spinner mb-2"></div>
        <p>Loading analytics details...</p>
      </td>
    </tr>
  `;
  popularityList.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading breakdown...</p></div>`;

  try {
    const res = await fetch(`/api/v2/admin/plan-analytics?year=${year}&month=${month}`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to fetch plan analytics');

    const result = await res.json();
    const data = result.data;

    // Render Stats
    document.getElementById('analytic-revenue').textContent = `₹${data.totalRevenue.toLocaleString()}`;
    document.getElementById('analytic-premium-count').textContent = data.totalPremiumActivations;
    document.getElementById('analytic-new-shops').textContent = data.newShopsCount;

    // Render Popularity breakdown
    if (data.popularity.length === 0) {
      popularityList.innerHTML = `<div class="text-center text-muted py-4">No subscriptions registered in this period.</div>`;
    } else {
      popularityList.innerHTML = '';
      data.popularity.forEach(item => {
        const percent = data.totalPremiumActivations > 0 ? Math.round((item.count / data.totalPremiumActivations) * 100) : 0;
        const progressDiv = document.createElement('div');
        progressDiv.className = 'breakdown-item';
        progressDiv.style.marginBottom = '1rem';
        progressDiv.innerHTML = `
          <div class="flex-between" style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.25rem;">
            <span>${item.planName}</span>
            <span class="text-muted">${item.count} sold (₹${item.revenue.toLocaleString()})</span>
          </div>
          <div class="progress-bar-container" style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; width: 100%;">
            <div class="progress-bar" style="background: var(--primary); height: 100%; width: ${percent}%; border-radius: 4px;"></div>
          </div>
        `;
        popularityList.appendChild(progressDiv);
      });
    }

    // Render Table Body
    if (data.activations.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted py-5">
            <i data-lucide="credit-card" class="large-icon mb-2"></i>
            <p>No plan activations recorded in this month</p>
          </td>
        </tr>
      `;
    } else {
      tableBody.innerHTML = '';
      data.activations.forEach(act => {
        const row = document.createElement('tr');
        const actDate = new Date(act.activatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        const expDate = new Date(act.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        
        row.innerHTML = `
          <td><strong>${act.shopName}</strong></td>
          <td>${act.ownerName || '—'}</td>
          <td><code>${act.phone}</code></td>
          <td><span class="badge badge-success">${act.planName}</span></td>
          <td><strong>₹${act.pricePaid}</strong></td>
          <td>${actDate}</td>
          <td>${expDate}</td>
        `;
        tableBody.appendChild(row);
      });
    }
    lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── REVENUE DASHBOARD ────────────────────────────────────────────────────
async function fetchRevenueDashboard() {
  const from = document.getElementById('revenue-from').value;
  const to = document.getElementById('revenue-to').value;
  let url = '/api/v2/admin/revenue-dashboard';
  const queryParams = [];
  if (from) queryParams.push(`from=${from}`);
  if (to) queryParams.push(`to=${to}`);
  if (queryParams.length > 0) url += `?${queryParams.join('&')}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to load revenue data');

    const result = await res.json();
    const data = result.data;

    // Set stats
    document.getElementById('rev-today').textContent = `₹${data.revenue.today.toLocaleString('en-IN')}`;
    document.getElementById('rev-monthly').textContent = `₹${data.revenue.monthly.toLocaleString('en-IN')}`;
    document.getElementById('rev-yearly').textContent = `₹${data.revenue.yearly.toLocaleString('en-IN')}`;
    document.getElementById('rev-lifetime').textContent = `₹${data.revenue.lifetime.toLocaleString('en-IN')}`;
    document.getElementById('rev-active-subs').textContent = data.subscribers.active;
    document.getElementById('rev-expired-subs').textContent = data.subscribers.expired;
    document.getElementById('rev-arpu').textContent = `₹${data.subscribers.arpu.toLocaleString('en-IN')}`;

    // Render charts
    const ctxTrend = document.getElementById('revenue-trend-chart').getContext('2d');
    if (revenueTrendChart) {
      revenueTrendChart.destroy();
    }
    const labels = data.trends.daily.map(t => t.date);
    const totals = data.trends.daily.map(t => parseInt(t.total, 10));

    revenueTrendChart = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Revenue (₹)',
          data: totals,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: 'rgba(255,255,255,0.6)' }
          },
          x: {
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: 'rgba(255,255,255,0.6)' }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });

    const ctxDist = document.getElementById('revenue-distribution-chart').getContext('2d');
    if (revenueDistributionChart) {
      revenueDistributionChart.destroy();
    }
    const planLabels = data.breakdown.map(b => b.planId === 'plan_6m' ? '6 Months' : (b.planId === 'plan_1y' ? '1 Year' : (b.planId || 'Custom')));
    const planCounts = data.breakdown.map(b => parseInt(b.count, 10));

    revenueDistributionChart = new Chart(ctxDist, {
      type: 'doughnut',
      data: {
        labels: planLabels,
        datasets: [{
          data: planCounts,
          backgroundColor: ['#f97316', '#3b82f6', '#10b981', '#a855f7'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: 'rgba(255,255,255,0.7)', font: { family: 'Outfit' } }
          }
        }
      }
    });

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── PREMIUM USERS DIRECTORY ──────────────────────────────────────────────
async function fetchPremiumUsers() {
  const tableBody = document.getElementById('premium-users-table-body');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-5"><div class="spinner"></div><p>Loading premium users...</p></td></tr>`;

  const searchVal = document.getElementById('premium-search').value.trim();
  const planId = document.getElementById('premium-filter-plan').value;
  const status = document.getElementById('premium-filter-status').value;

  let url = `/api/v2/admin/premium-users?page=${currentPremiumPage}&limit=20`;
  if (searchVal) url += `&search=${encodeURIComponent(searchVal)}`;
  if (planId) url += `&planId=${encodeURIComponent(planId)}`;
  if (status) url += `&status=${encodeURIComponent(status)}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) throw new Error('Failed to fetch premium user listing');

    const result = await res.json();
    const data = result.data;
    const users = data.users;

    // Set summary counters
    document.getElementById('prem-total-count').textContent = data.stats.totalPremium;
    document.getElementById('prem-active-count').textContent = data.stats.active;
    document.getElementById('prem-expiring-count').textContent = data.stats.expiringSoon;
    document.getElementById('prem-expired-count').textContent = data.stats.expired;

    if (users.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-5"><i data-lucide="users" class="large-icon mb-2"></i><p>No premium users found matching filters</p></td></tr>`;
      lucide.createIcons();
      return;
    }

    tableBody.innerHTML = users.map(user => {
      const planName = user.currentPlan === 'plan_6m' ? '6 Months' : (user.currentPlan === 'plan_1y' ? '1 Year' : (user.currentPlan || 'Custom'));
      const expiryStr = user.premiumExpiresAt ? new Date(user.premiumExpiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
      const lastActiveStr = user.lastActive ? new Date(user.lastActive).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      
      let daysLeftClass = 'badge-success';
      if (user.remainingDays <= 0) {
        daysLeftClass = 'badge-danger';
      } else if (user.remainingDays <= 7) {
        daysLeftClass = 'badge-warning';
      }

      return `
        <tr>
          <td><strong>${escapeHtml(user.shopName)}</strong></td>
          <td>${escapeHtml(user.ownerName || 'N/A')}</td>
          <td><code>${escapeHtml(user.phoneNumber)}</code></td>
          <td><span class="badge badge-info">${planName}</span></td>
          <td><code>${expiryStr}</code></td>
          <td><span class="badge ${daysLeftClass}">${user.remainingDays <= 0 ? 'Expired' : user.remainingDays + ' Days Left'}</span></td>
          <td><code style="font-size:0.8rem">${escapeHtml(user.deviceId || 'No device ID')}</code></td>
          <td><small>${lastActiveStr}</small></td>
          <td>
            <button class="btn-action" onclick="openPremiumUserModal('${user.id}')" title="Audit / Send Notification">
              <i data-lucide="eye"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();

  } catch (err) {
    showToast(err.message, 'error');
    tableBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">Error loading premium users directory</td></tr>`;
  }
}

// ─── PREMIUM SHOP DETAIL MODAL ──────────────────────────────────────────
async function openPremiumUserModal(shopId) {
  selectedPremiumShopId = shopId;
  const modal = document.getElementById('premium-user-modal');
  if (!modal) return;

  // Reset tab active state
  document.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.style.color = 'var(--text-muted)';
    btn.style.borderBottom = 'none';
  });
  const firstTab = document.querySelector('.modal-tab-btn[data-subtab="pm-payments"]');
  if (firstTab) {
    firstTab.classList.add('active');
    firstTab.style.color = '#fff';
    firstTab.style.borderBottom = '2px solid var(--primary)';
  }
  document.querySelectorAll('.modal-tab-panel').forEach(panel => {
    panel.style.display = 'none';
  });
  document.getElementById('subtab-pm-payments').style.display = 'block';

  // Load shop details
  try {
    const res = await fetch(`/api/v2/admin/premium-users/${shopId}/details`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) throw new Error('Failed to load premium user details');

    const result = await res.json();
    const data = result.data;
    const profile = data.profile;

    document.getElementById('pm-shop-id').textContent = profile.id;
    document.getElementById('pm-shop-plan').textContent = profile.premium_expires_at ? `Expires: ${new Date(profile.premium_expires_at).toLocaleDateString()}` : 'No active plan';
    document.getElementById('pm-shop-owner').textContent = `${profile.owner_name || 'N/A'} (${profile.phone_number})`;
    document.getElementById('pm-shop-device').textContent = profile.active_device_id || 'No device allocated';

    // Populate payments
    const paymentsTbody = document.getElementById('pm-payments-tbody');
    if (data.payments.length === 0) {
      paymentsTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No plan activations found.</td></tr>`;
    } else {
      paymentsTbody.innerHTML = data.payments.map(p => {
        return `
          <tr>
            <td>${new Date(p.activated_at).toLocaleDateString()}</td>
            <td><code>${p.plan_id || 'custom'}</code></td>
            <td><strong>₹${p.price_paid}</strong></td>
            <td>${new Date(p.expires_at).toLocaleDateString()}</td>
          </tr>
        `;
      }).join('');
    }

    // Populate sync logs
    const logsTbody = document.getElementById('pm-logs-tbody');
    if (data.logs.length === 0) {
      logsTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No sync log recorded in last 24h.</td></tr>`;
    } else {
      logsTbody.innerHTML = data.logs.map(l => {
        const time = new Date(l.synced_at).toLocaleTimeString();
        const badgeColor = l.sync_status === 'success' ? 'badge-success' : 'badge-danger';
        return `
          <tr>
            <td>${time}</td>
            <td>${l.entity_type}</td>
            <td>${l.operation}</td>
            <td><span class="badge ${badgeColor}">${l.sync_status}</span></td>
            <td><code style="font-size:0.75rem">${l.android_device_id || 'N/A'}</code></td>
          </tr>
        `;
      }).join('');
    }

    modal.classList.add('active');
    lucide.createIcons();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closePremiumUserModal() {
  const modal = document.getElementById('premium-user-modal');
  if (modal) {
    modal.classList.remove('active');
  }
  selectedPremiumShopId = null;
  document.getElementById('pm-notify-form').reset();
}

async function handleSendPremiumNotification(e) {
  e.preventDefault();
  if (!selectedPremiumShopId) return;

  const title = document.getElementById('pm-notify-title').value.trim();
  const body = document.getElementById('pm-notify-body').value.trim();
  const sendBtn = document.getElementById('pm-notify-submit-btn');

  sendBtn.disabled = true;
  sendBtn.querySelector('span').textContent = 'Sending...';

  try {
    const res = await fetch(`/api/v2/admin/premium-users/${selectedPremiumShopId}/notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ title, body })
    });

    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedError();
      return;
    }

    if (!res.ok) {
      const errRes = await res.json();
      throw new Error(errRes.error || 'Failed to send push notification');
    }

    showToast('Push alert sent successfully to user!', 'success');
    closePremiumUserModal();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.querySelector('span').textContent = 'Send Alert';
  }
}

// ─── FEEDBACK & IMPROVEMENT CENTER ──────────────────────────────────────────
async function loadFeedbackStats() {
  try {
    const res = await fetch('/api/v2/admin/feedback/stats', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) throw new Error('Failed to load feedback stats');
    const data = (await res.json()).data;
    
    document.getElementById('fb-stat-total').textContent = data.total;
    document.getElementById('fb-stat-open').textContent = data.open;
    document.getElementById('fb-stat-review').textContent = data.under_review;
    document.getElementById('fb-stat-progress').textContent = data.in_progress;
    document.getElementById('fb-stat-resolved').textContent = data.resolved;
    document.getElementById('fb-stat-closed').textContent = data.closed;
    document.getElementById('fb-stat-today').textContent = data.today;
  } catch (err) {
    console.error('loadFeedbackStats error', err);
  }
}

async function loadFeedbackList() {
  const tbody = document.getElementById('fb-table-body');
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem;"><div class="spinner" style="margin:0 auto;"></div><p style="margin-top:0.5rem;">Loading feedback list...</p></td></tr>`;

  const search = document.getElementById('fb-search').value.trim();
  const status = document.getElementById('fb-filter-status').value;
  const type = document.getElementById('fb-filter-type').value;
  const priority = document.getElementById('fb-filter-priority').value;
  const sub = document.getElementById('fb-filter-sub').value;
  const from = document.getElementById('fb-filter-from').value;
  const to = document.getElementById('fb-filter-to').value;

  let query = `?page=${currentFeedbackPage}&limit=15`;
  if (search) query += `&search=${encodeURIComponent(search)}`;
  if (status) query += `&status=${status}`;
  if (type) query += `&feedbackType=${type}`;
  if (priority) query += `&priority=${priority}`;
  if (sub) query += `&subscription=${sub}`;
  if (from) query += `&from=${from}`;
  if (to) query += `&to=${to}`;

  try {
    const res = await fetch(`/api/v2/admin/feedback${query}`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) throw new Error('Failed to load feedback list');
    const result = await res.json();
    const list = result.data;
    const meta = result.meta || {};

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:3rem; color:var(--text-secondary);">No feedback tickets found.</td></tr>`;
      document.getElementById('fb-page-info').textContent = 'Page 1 of 1';
      document.getElementById('fb-prev-btn').disabled = true;
      document.getElementById('fb-next-btn').disabled = true;
      return;
    }

    tbody.innerHTML = list.map(item => {
      const typeLabel = formatFeedbackType(item.feedback_type);
      const statusClass = getFeedbackStatusClass(item.status);
      const priorityBadge = getFeedbackPriorityBadge(item.priority);
      const dateStr = item.created_at ? new Date(item.created_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : 'N/A';

      return `
        <tr>
          <td><strong style="color:var(--primary);">${escapeHtml(item.ticket_number)}</strong></td>
          <td>
            <div style="font-weight:600;">${escapeHtml(item.shop_name || 'N/A')}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(item.phone_number || 'N/A')}</div>
          </td>
          <td><span class="badge badge-feature active">${typeLabel}</span></td>
          <td><div style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(item.subject)}">${escapeHtml(item.subject)}</div></td>
          <td>${priorityBadge}</td>
          <td><span class="badge ${statusClass}">${escapeHtml(item.status.replace('_',' '))}</span></td>
          <td style="font-size:0.8rem; color:var(--text-secondary);">${dateStr}</td>
          <td>
            <button class="btn btn-secondary" onclick="openFeedbackModal('${item.id}')" style="padding:0.35rem 0.75rem; border-radius:6px; font-size:0.75rem; height:auto;">
              <i data-lucide="eye" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> View
            </button>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();

    const totalPages = meta.totalPages || 1;
    document.getElementById('fb-page-info').textContent = `Page ${currentFeedbackPage} of ${totalPages} (Total ${meta.total || 0} tickets)`;
    document.getElementById('fb-prev-btn').disabled = currentFeedbackPage === 1;
    document.getElementById('fb-next-btn').disabled = currentFeedbackPage >= totalPages;

  } catch (err) {
    showToast(err.message, 'error');
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:#ef4444;">Error loading feedback.</td></tr>`;
  }
}

function feedbackPageChange(dir) {
  currentFeedbackPage += dir;
  loadFeedbackList();
}

async function openFeedbackModal(ticketId) {
  selectedFeedbackTicketId = ticketId;
  const modal = document.getElementById('fb-detail-modal');
  const container = document.getElementById('fb-detail-content');
  container.innerHTML = `<div class="spinner" style="margin:4rem auto;"></div>`;
  modal.style.display = 'block';

  try {
    const res = await fetch(`/api/v2/admin/feedback/${ticketId}`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) throw new Error('Failed to load ticket details');
    const data = (await res.json()).data;
    const ticket = data.ticket;

    // Reset actions fields
    document.getElementById('fb-action-status').value = ticket.status;
    document.getElementById('fb-action-priority').value = ticket.priority;
    document.getElementById('fb-reply-text').value = '';
    document.getElementById('fb-note-text').value = '';

    // Format attachments
    let attachmentsHtml = '<p style="color:var(--text-secondary); font-size:0.85rem;">No attachments.</p>';
    if (data.attachments && data.attachments.length > 0) {
      attachmentsHtml = `
        <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem;">
          ${data.attachments.map(att => {
            const isImage = att.mime_type.startsWith('image/');
            const isVideo = att.mime_type.startsWith('video/');
            const isAudio = att.mime_type.startsWith('audio/');
            
            let preview = '';
            if (isImage) {
              preview = `<img src="${att.firebase_url}" style="max-width:200px; max-height:200px; border-radius:8px; border:1px solid var(--border-color); display:block; margin-top:0.25rem;" onclick="window.open('${att.firebase_url}','_blank')">`;
            } else if (isVideo) {
              preview = `<video src="${att.firebase_url}" controls style="max-width:320px; border-radius:8px; display:block; margin-top:0.25rem;"></video>`;
            } else if (isAudio) {
              preview = `<audio src="${att.firebase_url}" controls style="display:block; margin-top:0.25rem;"></audio>`;
            }

            return `
              <div style="background:var(--bg-secondary); padding:0.5rem; border-radius:8px; border:1px solid var(--border-color);">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;">
                  <span>📁 <strong>${escapeHtml(att.file_name)}</strong> (${(att.file_size_bytes/1024/1024).toFixed(2)} MB)</span>
                  <a href="${att.firebase_url}" target="_blank" class="btn btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.7rem; height:auto;">Download</a>
                </div>
                ${preview}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Format replies
    let repliesHtml = '<p style="color:var(--text-secondary); font-size:0.85rem; text-align:center; padding:1rem;">No replies in this thread yet.</p>';
    if (data.replies && data.replies.length > 0) {
      repliesHtml = `
        <div style="display:flex; flex-direction:column; gap:0.75rem; max-height:300px; overflow-y:auto; padding-right:0.5rem;">
          ${data.replies.map(r => {
            const isAdmin = r.sender_type === 'admin';
            const align = isAdmin ? 'flex-start' : 'flex-end';
            const bg = isAdmin ? 'var(--bg-secondary)' : 'rgba(92,110,248,0.1)';
            const border = isAdmin ? '1px solid var(--border-color)' : '1px solid rgba(92,110,248,0.3)';
            const time = new Date(r.created_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
            
            return `
              <div style="align-self:${align}; max-width:85%; background:${bg}; border:${border}; padding:0.75rem; border-radius:12px;">
                <div style="display:flex; justify-content:space-between; gap:2rem; font-size:0.7rem; color:var(--text-secondary); margin-bottom:0.25rem;">
                  <strong>${escapeHtml(r.sender_label)}</strong>
                  <span>${time}</span>
                </div>
                <div style="font-size:0.85rem; color:#fff; white-space:pre-wrap;">${escapeHtml(r.message)}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Format notes
    let notesHtml = '<p style="color:var(--text-secondary); font-size:0.85rem;">No internal notes.</p>';
    if (data.notes && data.notes.length > 0) {
      notesHtml = `
        <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem;">
          ${data.notes.map(n => {
            const time = new Date(n.created_at).toLocaleString();
            return `
              <div style="background:rgba(217,119,6,0.06); border:1px dashed rgba(217,119,6,0.3); padding:0.5rem; border-radius:8px; font-size:0.8rem;">
                <div style="color:var(--text-secondary); font-size:0.7rem; margin-bottom:0.25rem;">By ${escapeHtml(n.admin_uid)} • ${time}</div>
                <div style="color:#fff;">${escapeHtml(n.note)}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Format previous tickets
    let prevTicketsHtml = '<p style="color:var(--text-secondary); font-size:0.85rem;">No other tickets from this shop.</p>';
    if (data.prevTickets && data.prevTickets.length > 0) {
      prevTicketsHtml = `
        <div style="display:flex; flex-direction:column; gap:0.4rem; margin-top:0.5rem;">
          ${data.prevTickets.map(pt => {
            const statusClass = getFeedbackStatusClass(pt.status);
            const date = new Date(pt.created_at).toLocaleDateString();
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-secondary); padding:0.4rem 0.6rem; border-radius:6px; font-size:0.75rem;">
                <span><strong>${escapeHtml(pt.ticket_number)}</strong> (${escapeHtml(pt.feedback_type)})</span>
                <span class="badge ${statusClass}">${escapeHtml(pt.status)}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const typeLabel = formatFeedbackType(ticket.feedback_type);
    const priorityBadge = getFeedbackPriorityBadge(ticket.priority);
    const statusClass = getFeedbackStatusClass(ticket.status);

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem;">
        <div>
          <h2 style="margin:0; color:var(--primary); display:flex; align-items:center; gap:0.5rem;">
            ${escapeHtml(ticket.ticket_number)}
            <span class="badge ${statusClass}">${escapeHtml(ticket.status.replace('_',' '))}</span>
          </h2>
          <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.25rem;">
            Category: <strong>${typeLabel}</strong> • Priority: ${priorityBadge}
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 2fr 1fr; gap:1.5rem;">
        <!-- Left Side: Description + Conversation -->
        <div>
          <div class="card" style="padding:1rem; margin-bottom:1rem;">
            <h4 style="margin-top:0;">Subject: ${escapeHtml(ticket.subject)}</h4>
            <div style="white-space:pre-wrap; line-height:1.5; color:#fff; font-size:0.9rem;">${escapeHtml(ticket.description || '')}</div>
          </div>

          <div class="card" style="padding:1rem; margin-bottom:1rem; display:flex; flex-direction:column; gap:0.75rem;">
            <h4 style="margin-top:0; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem;">Thread</h4>
            ${repliesHtml}
          </div>

          <div class="card" style="padding:1rem;">
            <h4 style="margin-top:0;">Attachments</h4>
            ${attachmentsHtml}
          </div>
        </div>

        <!-- Right Side: Metadata + Logs -->
        <div>
          <div class="card" style="padding:1rem; margin-bottom:1rem; font-size:0.8rem;">
            <h4 style="margin-top:0; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem;">User Info</h4>
            <div style="margin-bottom:0.35rem;"><strong>Shop:</strong> ${escapeHtml(ticket.shop_name || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Owner:</strong> ${escapeHtml(ticket.owner_name || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Phone:</strong> ${escapeHtml(ticket.phone_number || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Address:</strong> ${escapeHtml(ticket.shop_address || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Account:</strong> ${escapeHtml(ticket.login_account || 'N/A')}</div>
          </div>

          <div class="card" style="padding:1rem; margin-bottom:1rem; font-size:0.8rem;">
            <h4 style="margin-top:0; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem;">Device Details</h4>
            <div style="margin-bottom:0.35rem;"><strong>Brand:</strong> ${escapeHtml(ticket.device_brand || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Model:</strong> ${escapeHtml(ticket.device_model || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Android:</strong> ${escapeHtml(ticket.android_version || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Resolution:</strong> ${escapeHtml(ticket.screen_resolution || 'N/A')}</div>
            <div style="margin-bottom:0.35rem;"><strong>App Version:</strong> ${escapeHtml(ticket.app_version || 'N/A')} (${escapeHtml(ticket.app_version_code || '')})</div>
            <div style="margin-bottom:0.35rem;"><strong>Language:</strong> ${escapeHtml(ticket.app_language || 'en')}</div>
            <div style="margin-bottom:0.35rem;"><strong>Plan:</strong> ${escapeHtml(ticket.subscription_status || 'free')}</div>
          </div>

          <div class="card" style="padding:1rem; margin-bottom:1rem;">
            <h4 style="margin-top:0; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem;">Internal Notes</h4>
            ${notesHtml}
          </div>

          <div class="card" style="padding:1rem;">
            <h4 style="margin-top:0; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem;">Previous Tickets</h4>
            ${prevTicketsHtml}
          </div>
        </div>
      </div>
    `;

  } catch (err) {
    container.innerHTML = `<div style="color:#ef4444; padding:2rem; text-align:center;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function closeFeedbackModal() {
  document.getElementById('fb-detail-modal').style.display = 'none';
  selectedFeedbackTicketId = null;
}

async function applyFeedbackStatus() {
  if (!selectedFeedbackTicketId) return;
  const status = document.getElementById('fb-action-status').value;
  if (!status) return;

  try {
    const res = await fetch(`/api/v2/admin/feedback/${selectedFeedbackTicketId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed to update status');
    showToast('Status updated!', 'success');
    loadFeedbackStats();
    loadFeedbackList();
    openFeedbackModal(selectedFeedbackTicketId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function applyFeedbackPriority() {
  if (!selectedFeedbackTicketId) return;
  const priority = document.getElementById('fb-action-priority').value;
  if (!priority) return;

  try {
    const res = await fetch(`/api/v2/admin/feedback/${selectedFeedbackTicketId}/priority`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ priority })
    });
    if (!res.ok) throw new Error('Failed to update priority');
    showToast('Priority updated!', 'success');
    loadFeedbackList();
    openFeedbackModal(selectedFeedbackTicketId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteFeedbackTicket() {
  if (!selectedFeedbackTicketId) return;
  if (!confirm('Are you sure you want to permanently delete this ticket?')) return;

  try {
    const res = await fetch(`/api/v2/admin/feedback/${selectedFeedbackTicketId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) throw new Error('Failed to delete ticket');
    showToast('Ticket deleted!', 'success');
    closeFeedbackModal();
    loadFeedbackStats();
    loadFeedbackList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function sendFeedbackReply() {
  if (!selectedFeedbackTicketId) return;
  const text = document.getElementById('fb-reply-text').value.trim();
  if (!text) return;

  try {
    const res = await fetch(`/api/v2/admin/feedback/${selectedFeedbackTicketId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ message: text })
    });
    if (!res.ok) throw new Error('Failed to send reply');
    showToast('Reply sent and user notified!', 'success');
    openFeedbackModal(selectedFeedbackTicketId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function addFeedbackNote() {
  if (!selectedFeedbackTicketId) return;
  const note = document.getElementById('fb-note-text').value.trim();
  if (!note) return;

  try {
    const res = await fetch(`/api/v2/admin/feedback/${selectedFeedbackTicketId}/note`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ note })
    });
    if (!res.ok) throw new Error('Failed to add internal note');
    showToast('Note saved!', 'success');
    openFeedbackModal(selectedFeedbackTicketId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function exportFeedback(format = 'csv') {
  try {
    const search = document.getElementById('fb-search').value.trim();
    const status = document.getElementById('fb-filter-status').value;
    const type = document.getElementById('fb-filter-type').value;
    const priority = document.getElementById('fb-filter-priority').value;
    const from = document.getElementById('fb-filter-from').value;
    const to = document.getElementById('fb-filter-to').value;

    let query = `?format=${format}`;
    if (search) query += `&search=${encodeURIComponent(search)}`;
    if (status) query += `&status=${status}`;
    if (type) query += `&feedbackType=${type}`;
    if (priority) query += `&priority=${priority}`;
    if (from) query += `&from=${from}`;
    if (to) query += `&to=${to}`;

    const res = await fetch(`/api/v2/admin/feedback/export${query}`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) throw new Error('Failed to export feedback data');

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feedback_export_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatFeedbackType(type) {
  const map = {
    bug_report: '🐛 Bug Report',
    feature_request: '💡 Feature Request',
    improvement: '⚡ Improvement',
    ui_ux: '🎨 UI / UX',
    performance: '🚀 Performance',
    payment_issue: '💳 Payment Issue',
    premium_issue: '👑 Premium Issue',
    report_issue: '📄 Report Issue',
    sync_issue: '🔄 Sync Issue',
    other: '📝 Other'
  };
  return map[type] || type;
}

function getFeedbackStatusClass(status) {
  const map = {
    open: 'badge-feature',
    under_review: 'badge-feature active',
    in_progress: 'badge-warning',
    resolved: 'badge-success',
    closed: 'badge-muted'
  };
  return map[status] || '';
}

function getFeedbackPriorityBadge(priority) {
  const map = {
    critical: '<span style="color:#ef4444; font-weight:bold;">🔴 Critical</span>',
    high: '<span style="color:#f97316; font-weight:bold;">🟠 High</span>',
    medium: '<span style="color:#eab308; font-weight:bold;">🟡 Medium</span>',
    low: '<span style="color:#22c55e; font-weight:bold;">🟢 Low</span>'
  };
  return map[priority] || priority;
}


