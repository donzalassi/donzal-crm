// ===== 1. 전역 상태 관리 (Multi-tenancy) =====
let currentOwnerId = localStorage.getItem('donzal_owner_id') || null;
let currentOwnerInfo = null;
let dbCustomers = [];
let dbVisits = [];
let dbConfig = { storeName: '돈잘베어 매장', senderNumber: '', apiKey: '', apiSecret: '' };

// 읽기/쓰기 동기화 헬퍼
function getCustomers() { return dbCustomers; }
function getVisits() { return dbVisits; }
function loadConfig() { return dbConfig; }

// 데이터 서버 연동 (SaaS 방식)
async function syncData() {
  const ownerId = localStorage.getItem('donzal_owner_id');
  if (!ownerId) return;

  try {
    const response = await fetch('/api/data/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId })
    });
    const result = await response.json();
    
    if (result.success) {
      const data = result.data;
      dbCustomers = data.customers || [];
      dbVisits = data.visits || [];
      dbConfig = data.config || { storeName: '돈잘베어 매장', senderNumber: '', apiKey: '', apiSecret: '', manualExclusions: [], manualInclusions: [] };
      
      // Update UI with Owner Info
      const currentOwner = data.owner;
      if (currentOwner) {
        const nameEl = document.getElementById('current-owner-name');
        const statusEl = document.getElementById('current-subscription-status');
        
        // [수정] 관리자 계정 여부에 따른 이름 표시 분기
        const isAdmin = currentOwner.email === 'shsh3@naver.com';
        if (nameEl) {
          nameEl.textContent = isAdmin ? '시스템 마스터' : (currentOwner.name || '사장님') + ' 사장님';
        }
        
        if (statusEl) {
          statusEl.textContent = isAdmin ? '마스터 권한' : (currentOwner.status === 'Active' ? '구독 활성' : '승인 대기/만료');
          statusEl.style.color = currentOwner.status === 'Active' ? '#4ade80' : (isAdmin ? '#d4af37' : '#f87171');
        }
        
        // Master Admin Check
        const adminMenu = document.getElementById('nav-admin');
        if (isAdmin && adminMenu) {
          adminMenu.style.display = 'flex';
        }

        // Show/Hide Dashboard based on status
        if (currentOwner.status !== 'Active') {
          showPendingScreen();
        }
      }
      
      updateDashboard();
      updateTodayList();
    }
  } catch (error) {
    console.error('Sync failed:', error);
    showToast('데이터 동기화 실패');
  }
}

function showPendingScreen() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('pending-section').style.display = 'block';
  }
}

async function saveCustomers(data) {
  dbCustomers = data;
  await persistData({ customers: data });
}

async function saveVisits(data) {
  dbVisits = data;
  await persistData({ visits: data });
}

async function persistData(payload) {
  if (!currentOwnerId) return;
  updateSyncStatus('loading');
  try {
    const res = await fetch('/api/data/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: currentOwnerId, ...payload })
    });
    if (res.ok) updateSyncStatus('online');
  } catch (e) {
    updateSyncStatus('offline');
    showToast('❌ 서버 저장 실패 (네트워크 확인)');
  }
}

function updateSyncStatus(state) {
  const badge = document.getElementById('sync-status');
  if(!badge) return;
  const label = badge.querySelector('span');
  if (state === 'online') { badge.className = 'sync-badge sync-online'; label.textContent = '서버 연동 중'; }
  else if (state === 'loading') { badge.className = 'sync-badge sync-online'; label.textContent = '데이터 처리 중...'; }
  else { badge.className = 'sync-badge sync-offline'; label.textContent = '연결 끊김'; }
}

// ===== AUTH LOGIC (SaaS) =====

function toggleAuth(type) {
  document.getElementById('login-form').style.display = type === 'login' ? 'block' : 'none';
  document.getElementById('signup-form').style.display = type === 'signup' ? 'block' : 'none';
  document.getElementById('pending-section').style.display = type === 'pending' ? 'block' : 'none';
}

async function handleLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  
  if(!email || !password) { showToast('정보를 모두 입력해 주세요.'); return; }
  
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await res.json();
    
    if (result.success) {
      currentOwnerId = result.ownerId;
      localStorage.setItem('donzal_owner_id', currentOwnerId);
      document.body.classList.add('authenticated');
      showToast(result.storeName + ' 사장님, 반갑습니다! 👑');
      syncData();
    } else {
      showToast('❌ ' + result.message);
    }
  } catch (e) {
    showToast('❌ 서버 연결 실패');
  }
}

async function handleSignup() {
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const name = document.getElementById('signup-name').value;
  const storeName = document.getElementById('signup-store').value;

  if(!email || !password || !name || !storeName) { showToast('모든 정보를 채워주세요.'); return; }

  const btn = event.target;
  const originalText = btn.textContent;
  
  try {
    btn.disabled = true;
    btn.textContent = '⏱ 신청 처리 중...';
    
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, storeName })
    });
    const result = await res.json();
    if (result.success) {
      showToast('🎉 가입 신청 완료! 승인을 기다려주세요.');
      setTimeout(() => {
        toggleAuth('pending');
      }, 1500);
    } else {
      showToast('❌ ' + result.message);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch (e) {
    showToast('❌ 서버 연결 실패');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function handleLogout() {
  localStorage.removeItem('donzal_owner_id');
  location.reload();
}

function updateUIAfterSync() {
  if (!currentOwnerInfo) return;
  document.getElementById('current-owner-name').textContent = currentOwnerInfo.storeName;
  document.getElementById('current-subscription-status').textContent = '구독 ' + (currentOwnerInfo.status === 'Active' ? '활성' : '만료');
  document.getElementById('config-store-name').value = dbConfig.storeName;
  document.getElementById('config-sender').value = dbConfig.senderNumber;
  document.getElementById('config-api-key').value = dbConfig.apiKey;
  document.getElementById('config-api-secret').value = dbConfig.apiSecret;
  
  // 처음 로그인 시 대시보드 렌더링
  updateDashboard();
}

// ===== 마케팅 로직 및 데이터 가공 =====

function getAnalyzedData() {
  const customers = getCustomers();
  const visits = getVisits();
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(now.getDate() - 30);

  return customers.map(c => {
    const cVisits = visits.filter(v => v.Phone === c.Phone);
    cVisits.sort((a, b) => new Date(b.VisitDate) - new Date(a.VisitDate));

    // 최근 방문 정보
    const lastVisitDate = cVisits.length > 0 ? cVisits[0].VisitDate : null;
    let daysSinceLastVisit = 999;
    if (lastVisitDate) {
      daysSinceLastVisit = Math.floor((now - new Date(lastVisitDate)) / (1000 * 60 * 60 * 24));
    }

    // 통계 정보
    const recent30DayVisits = cVisits.filter(v => new Date(v.VisitDate) >= thirtyDaysAgo).length;
    const totalSpend = cVisits.reduce((sum, v) => sum + v.SpendAmount, 0);
    const thisMonthSpend = cVisits.filter(v => {
      const d = new Date(v.VisitDate);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((sum, v) => sum + v.SpendAmount, 0);

    // 상태 판별 로직
    let status = 'normal';
    let statusLabel = '일반';

    const config = loadConfig();
    const exclusions = config.manualExclusions || [];
    const inclusions = config.manualInclusions || []; // { phone: '...', targetType: 'vip' } 형태

    // 수동 상태 체크
    const isExcluded = exclusions.includes(c.Phone);
    const manualEntry = inclusions.find(inc => inc.phone === c.Phone);

    // VIP 조건: 30일 내 3회 이상 방문 또는 총 결제액 20만 원 이상 (또는 수동 포함)
    if (!isExcluded && (recent30DayVisits >= 3 || totalSpend >= 200000 || (manualEntry && manualEntry.targetType === 'vip'))) {
      status = 'vip'; statusLabel = '👑 VIP';
    } else if (!isExcluded && ((daysSinceLastVisit >= 60 && lastVisitDate !== null) || (manualEntry && manualEntry.targetType === 'dormant'))) {
      status = 'dormant'; statusLabel = '💤 휴면';
    } else if (daysSinceLastVisit <= 7) {
      status = 'new'; statusLabel = '최근방문';
    }

    return {
      ...c,
      lastVisitDate,
      daysSinceLastVisit,
      thisMonthSpend,
      totalSpend,
      status,
      statusLabel,
      totalVisits: cVisits.length,
      recent30DayVisits,
      isExcluded
    };
  });
}

// 타겟 수동 관리 토글
async function toggleManualTarget(phone, action, targetType = 'vip') {
  let config = loadConfig();
  if (!config.manualExclusions) config.manualExclusions = [];
  if (!config.manualInclusions) config.manualInclusions = [];
  
  if (action === 'exclude') {
    // 수동 포함 목록에서도 제거
    config.manualInclusions = config.manualInclusions.filter(inc => inc.phone !== phone);
    if (!config.manualExclusions.includes(phone)) {
      config.manualExclusions.push(phone);
      showToast('해당 고객을 마케팅 대상에서 제외했습니다.');
    }
  } else if (action === 'include') {
    config.manualExclusions = config.manualExclusions.filter(p => p !== phone);
    // 강제 포함 (이미 VIP가 아닐 경우를 대비해 targetType 저장)
    if (!config.manualInclusions.find(inc => inc.phone === phone)) {
      config.manualInclusions.push({ phone, targetType });
    }
    showToast(`해당 고객을 ${targetType === 'vip' ? 'VIP' : '휴면'} 타겟으로 지정했습니다.`);
  } else if (action === 'reset') {
    config.manualExclusions = config.manualExclusions.filter(p => p !== phone);
    config.manualInclusions = config.manualInclusions.filter(inc => inc.phone !== phone);
    showToast('수동 설정을 초기화했습니다.');
  }

  dbConfig = config;
  await persistData({ config: config });
  
  // 현재 페이지 새로고침
  const activePage = document.querySelector('.page.active').id.replace('page-', '');
  showPage(activePage);
}

// 금액 포맷팅 헬퍼
function formatMoney(amount) {
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + '원';
}

// ===== 3. UI 업데이트 렌더링 =====

// 현재 날짜 세팅
document.getElementById('current-date').textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

function updateDashboard() {
  const analyzed = getAnalyzedData();
  const visits = getVisits();
  
  const now = new Date();
  const thisMonthVisits = visits.filter(v => {
    const vDate = new Date(v.VisitDate);
    return vDate.getMonth() === now.getMonth() && vDate.getFullYear() === now.getFullYear();
  });
  
  const totalRev = thisMonthVisits.reduce((sum, v) => sum + v.SpendAmount, 0);
  const vipCount = analyzed.filter(c => c.status === 'vip').length;
  const dormantCount = analyzed.filter(c => c.status === 'dormant').length;
  
  // KPI 업데이트
  animateValue('kpi-total', 0, analyzed.length, 1000);
  animateValue('kpi-vip', 0, vipCount, 1000);
  
  const revEl = document.getElementById('kpi-revenue');
  if (revEl) revEl.textContent = formatMoney(totalRev);
  
  animateValue('kpi-dormant', 0, dormantCount, 1000);
  
  // 최근 방문 내역 미니 테이블 (최대 5개)
  const recentVisits = [...visits].sort((a,b) => new Date(b.VisitDate) - new Date(a.VisitDate)).slice(0,5);
  const tb = document.getElementById('recent-tbody');
  if (tb) {
    tb.innerHTML = '';
    recentVisits.forEach(v => {
      const c = analyzed.find(c => c.Phone === v.Phone);
      tb.innerHTML += `
        <tr>
          <td><strong>${c ? c.Name : '알수없음'}</strong></td>
          <td>${v.VisitDate}</td>
          <td style="color:var(--accent-success)">${formatMoney(v.SpendAmount)}</td>
          <td>${v.IsFirstVisit ? '<span style="color:var(--accent-danger);font-size:12px">첫방문할인</span>' : '-'}</td>
        </tr>
      `;
    });
  }
  
  // 액션 패널 생성
  const actGrid = document.getElementById('action-grid');
  if (actGrid) {
    actGrid.innerHTML = '';
    if (vipCount > 0) {
      actGrid.innerHTML += `
        <div class="action-item">
          <div class="act-text">
            <div class="title">👑 VIP 고객 ${vipCount}명 달성</div>
            <div class="desc">30일 내 3회 이상 방문하거나 20만원 이상 결제한 주역들입니다.</div>
          </div>
          <button class="act-btn" onclick="showPage('targeting')">발송하기</button>
        </div>
      `;
    }
    if (dormantCount > 0) {
      actGrid.innerHTML += `
        <div class="action-item" style="border-color: var(--accent-blue);">
          <div class="act-text">
            <div class="title" style="color:var(--accent-blue)">💤 이탈 위기 (휴면) ${dormantCount}명</div>
            <div class="desc">60일 이상 미방문 고객입니다. 컴백 쿠폰으로 발길을 되돌리세요.</div>
          </div>
          <button class="act-btn" style="background:var(--accent-blue)" onclick="showPage('targeting')">유도하기</button>
        </div>
      `;
    }
  }
  
  // 통계 바 (Stat Bars)
  const stats = document.getElementById('stat-bars');
  if (stats) {
    const vipPct = Math.round((vipCount / analyzed.length) * 100) || 0;
    const dormPct = Math.round((dormantCount / analyzed.length) * 100) || 0;
    stats.innerHTML = `
      <div class="stat-item">
        <div class="stat-header">
          <span>VIP 전환율</span>
          <span style="color:var(--accent-gold);font-weight:bold">${vipPct}%</span>
        </div>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:0%; background:var(--accent-gold)" data-width="${vipPct}%"></div></div>
      </div>
      <div class="stat-item">
        <div class="stat-header">
          <span>휴면 고객 비율</span>
          <span style="color:var(--accent-blue);font-weight:bold">${dormPct}%</span>
        </div>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:0%; background:var(--accent-blue)" data-width="${dormPct}%"></div></div>
      </div>
    `;
    
    setTimeout(() => {
      document.querySelectorAll('.stat-bar-fill').forEach(bar => {
        bar.style.width = bar.getAttribute('data-width');
      });
    }, 100);
  }
}

// 고객 관리 페이지 필터링 및 렌더링
let currentFilter = 'all';

function filterCustomers(type) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-' + type);
  if (btn) btn.classList.add('active');
  currentFilter = type;
  
  const analyzed = getAnalyzedData();
  let result = analyzed;
  
  const fInfo = document.getElementById('filter-info');
  const smsPanel = document.getElementById('sms-panel');
  const smsIcon = document.getElementById('sms-icon');
  const smsTitle = document.getElementById('sms-title');
  const smsMsg = document.getElementById('sms-message');
  const smsCnt = document.getElementById('sms-count-text');
  
  if (type === 'vip') {
    result = analyzed.filter(c => c.status === 'vip');
    fInfo.style.display = 'flex';
    fInfo.innerHTML = `💡 <b>타겟팅 조건:</b> 30일 내 3회 이상 방문 또는 누적 결제금액 20만 원 이상 고객`;
    fInfo.style.borderLeftColor = 'var(--accent-gold)';
    
    smsPanel.style.display = 'block';
    smsIcon.textContent = '👑';
    smsTitle.textContent = 'VIP 타겟 마케팅 (고기 쿠폰)';
    smsMsg.innerHTML = `[${dbConfig.storeName}] 우수 고객님께!<br/>5만원 상당의 고기 추가 쿠폰을 드립니다.<br/>다음 방문 시 제시해주세요.`;
    smsCnt.textContent = `대상: 총 ${result.length}명`;
    document.getElementById('send-btn').style.background = 'linear-gradient(135deg, var(--accent-gold), #b38f00)';
    document.getElementById('send-btn').style.color = '#000';
    
  } else if (type === 'dormant') {
    result = analyzed.filter(c => c.status === 'dormant');
    fInfo.style.display = 'flex';
    fInfo.innerHTML = `💡 <b>타겟팅 조건:</b> 가장 최근 방문일이 오늘 기준 60일 이전인 미방문 고객`;
    fInfo.style.borderLeftColor = 'var(--accent-blue)';
    
    smsPanel.style.display = 'block';
    smsIcon.textContent = '💤';
    smsTitle.textContent = '휴면 타겟 마케팅 (컴백 쿠폰)';
    smsMsg.innerHTML = `[${dbConfig.storeName}] 보고 싶었어요!<br/>재방문 시 불고기 2인분을 서비스로 대접해 드릴게요!<br/>이번 주말 꼭 들러주세요.`;
    smsCnt.textContent = `대상: 총 ${result.length}명`;
    document.getElementById('send-btn').style.background = 'linear-gradient(135deg, var(--accent-blue), #2980b9)';
    document.getElementById('send-btn').style.color = '#fff';
    
  } else {
    fInfo.style.display = 'none';
    smsPanel.style.display = 'none';
  }
  
  renderCustomerTable(result);
}

function renderCustomerTable(data) {
  const tb = document.getElementById('customer-tbody');
  if (!tb) return;
  tb.innerHTML = '';
  
  if(data.length === 0) {
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted)">조회된 데이터가 없습니다.</td></tr>`;
    return;
  }
  
  data.forEach(c => {
    let dayText = c.daysSinceLastVisit === 999 ? '기록없음' : `${c.daysSinceLastVisit}일 전`;
    if(c.daysSinceLastVisit === 0) dayText = '오늘';
    
    tb.innerHTML += `
      <tr>
        <td>${c.Name}</td>
        <td>${c.Phone}</td>
        <td>${c.Region}</td>
        <td>${c.Gender}</td>
        <td>${c.JoinDate}</td>
        <td style="color:var(--accent-success); font-weight:bold;">${formatMoney(c.totalSpend)}</td>
        <td>${dayText}</td>
        <td><span class="status-badge ${c.status}">${c.statusLabel}</span></td>
        <td>
          <div style="display:flex; gap:5px;">
            <button class="action-sm-btn" onclick="openEditModal('${c.Phone}')">⚙️</button>
            ${c.isExcluded 
              ? `<button class="action-sm-btn" onclick="toggleManualTarget('${c.Phone}', 'reset')" style="background:var(--accent-success); color:#000">타겟복원</button>`
              : `<button class="action-sm-btn" onclick="toggleManualTarget('${c.Phone}', 'exclude')" title="마케팅 대상에서 제외" style="background:rgba(239, 68, 68, 0.1); color:var(--accent-danger)">타겟제외</button>`
            }
          </div>
        </td>
      </tr>
    `;
  });
}

// 방문 내역 렌더링
function updateVisitsPage() {
  const visits = getVisits();
  const customers = getCustomers();
  visits.sort((a,b) => new Date(b.VisitDate) - new Date(a.VisitDate));
  
  const badge = document.getElementById('visit-count-badge');
  if (badge) badge.textContent = `총 ${visits.length}건`;
  
  const tb = document.getElementById('visits-tbody');
  if (tb) {
    tb.innerHTML = '';
    visits.forEach(v => {
      const c = customers.find(x => x.Phone === v.Phone);
      const discountBadge = v.IsFirstVisit ? `<span class="badge" style="background:rgba(212,175,55,0.2);color:var(--accent-gold)">신규20%할인</span>` : '-';
      
      tb.innerHTML += `
        <tr>
          <td>${v.VisitID}</td>
          <td><strong>${c ? c.Name : '알수없음'}</strong></td>
          <td>${v.Phone}</td>
          <td>${v.VisitDate}</td>
          <td style="color:var(--accent-success); font-weight:bold;">${formatMoney(v.SpendAmount)}</td>
          <td>${discountBadge}</td>
        </tr>
      `;
    });
  }
}

// 타겟 마케팅 페이지 렌더링
function updateTargetingPage() {
  const analyzed = getAnalyzedData();
  const vips = analyzed.filter(c => c.status === 'vip');
  const dormants = analyzed.filter(c => c.status === 'dormant');
  
  const vt = document.getElementById('vip-target-list');
  if (vt) {
    vt.innerHTML = vips.length === 0 ? '<div class="t-item" style="justify-content:center;color:#999">대상이 없습니다</div>' :
      vips.map(c => `
        <div class="t-item">
          <label style="display:flex; align-items:center; cursor:pointer;">
            <input type="checkbox" class="target-chk-vip" value="${c.Phone}" checked style="margin-right:8px; accent-color:var(--accent-gold); width:16px; height:16px;">
            <span>${c.Name} (${c.Phone.slice(-4)})</span>
          </label>
          <span style="color:var(--accent-gold)">${formatMoney(c.totalSpend)}</span>
        </div>
      `).join('');
  }
  
  const dt = document.getElementById('dormant-target-list');
  if (dt) {
    dt.innerHTML = dormants.length === 0 ? '<div class="t-item" style="justify-content:center;color:#999">대상이 없습니다</div>' :
      dormants.map(c => `
        <div class="t-item">
          <label style="display:flex; align-items:center; cursor:pointer;">
            <input type="checkbox" class="target-chk-dormant" value="${c.Phone}" checked style="margin-right:8px; accent-color:var(--accent-blue); width:16px; height:16px;">
            <span>${c.Name} (${c.Phone.slice(-4)})</span>
          </label>
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="color:var(--accent-blue)">${c.daysSinceLastVisit}일 전</span>
            <button onclick="toggleManualTarget('${c.Phone}', 'exclude')" style="background:none; border:none; cursor:pointer; font-size:12px; color:#f87171">제외</button>
          </div>
        </div>
      `).join('');
  }
}

async function sendTargetSMS(type) {
  const chkClass = type === 'vip' ? '.target-chk-vip' : '.target-chk-dormant';
  const checkedBoxes = Array.from(document.querySelectorAll(`${chkClass}:checked`)).map(el => el.value);
  
  const analyzed = getAnalyzedData();
  const targets = analyzed.filter(c => c.status === type && checkedBoxes.includes(c.Phone));
  const targetCount = targets.length;
  
  if(targetCount === 0) { showToast('체크된 발송 대상이 없습니다 😅'); return; }

  const config = loadConfig();
  if(!config.apiKey || !config.apiSecret || !config.senderNumber) {
    showToast('🚨 [환경설정] 탭에서 솔라피 키를 먼저 입력해주세요!');
    showPage('settings');
    return;
  }

  let text = '';
  if(type === 'vip') text = `🥩 [${config.storeName}] 우수 고객님께!\\n5만원 상당의 프리미엄 고기 추가 쿠폰을 드립니다 🎁\\n다음 방문 시 직원에게 문자 제시 (유효기간: 이달말)`;
  if(type === 'dormant') text = `🔥 [${config.storeName}] 보고 싶었어요!\\n재방문 시 불고기 2인분 서비스 🎁\\n이번 주말 오시면 특별히 대접해 드릴게요!`;

  showToast('문자 발송 요청 중입니다... ⏳');
  
  try {
    const res = await fetch('/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targets: targets.map(t => ({ name: t.Name, phone: t.Phone })),
        text: text,
        config: config
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`[성공] ${targetCount}명에게 API 연동 문자 발송 완료! 🎉`);
      const log = document.getElementById('send-log');
      if (log) {
        const el = document.createElement('div');
        el.className = 'log-item';
        el.innerHTML = `
          <div>
            <div style="font-weight:bold;margin-bottom:5px;">${type==='vip'?'👑 VIP':'💤 휴면'} 쿠폰 발송</div>
            <div style="font-size:12px;color:var(--text-muted)">${new Date().toLocaleString()} | 대상: ${targetCount}명</div>
          </div>
          <span class="badge" style="background:var(--accent-success);color:#000">발송완료</span>
        `;
        log.prepend(el);
      }
    } else {
      showToast('❌ 오류: ' + data.message);
    }
  } catch(e) {
    showToast('🚨 백엔드 서버 연결 실패! server.js를 확인하세요.');
  }
}

// ===== 4. 신규/기존 등록 및 결제 로직 (SaaS) =====
let matchedCustomer = null;

function lookupCustomer() {
  const inputVal = document.getElementById('lookup-phone').value;
  const query = inputVal.replace(/[^0-9]/g, '');
  if(query.length < 4) { showToast('전화번호 뒷자리 등 4자리 이상 입력하세요.'); return; }
  
  const matches = getCustomers().filter(c => c.Phone.replace(/[^0-9]/g, '').includes(query));
  const res = document.getElementById('lookup-result');
  const existForm = document.getElementById('existing-payment');
  if (existForm) existForm.style.display = 'none';
  
  if (matches.length > 0) {
    res.innerHTML = `
      <div style="margin-bottom:10px; font-size:13px; color:var(--text-muted);">총 ${matches.length}명의 고객이 검색되었습니다.</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${matches.map(c => `<button class="lookup-select-btn" onclick="selectCustomerForPayment('${c.Phone}')">👤 ${c.Name} (${c.Phone})</button>`).join('')}
        <button class="lookup-select-btn new-btn" onclick="showNewCustomerForm('${inputVal}')">➕ 신규 고객으로 등록하기</button>
      </div>`;
  } else {
    res.innerHTML = `<span style="color:var(--accent-gold)">ℹ️ 신규 고객으로 등록해주세요.</span>`;
    showNewCustomerForm(inputVal);
  }
}

function selectCustomerForPayment(phone) {
  matchedCustomer = getCustomers().find(c => c.Phone === phone);
  const res = document.getElementById('lookup-result');
  const existForm = document.getElementById('existing-payment');
  res.innerHTML = `<span style="color:var(--accent-success); font-weight:bold;">✅ ${matchedCustomer.Name}님 선택 완료! 결제 금액을 입력하세요.</span>`;
  if (existForm) existForm.style.display = 'block';
  
  const analyzedItem = getAnalyzedData().find(c => c.Phone === phone);
  document.getElementById('existing-info').innerHTML = `
    <div class="exist-avatar">${matchedCustomer.Name.charAt(0)}</div>
    <div class="exist-details">
      <h4>${matchedCustomer.Name} 고객님</h4>
      <p style="margin-top:5px; color:var(--accent-gold); font-weight:700;">누적 결제: ${formatMoney(analyzedItem.totalSpend)} / 총 방문: ${analyzedItem.totalVisits}회</p>
      <p style="font-size:12px; color:var(--text-muted);">등급: ${analyzedItem.statusLabel}</p>
    </div>`;
  document.getElementById('exist-amount').focus();
}

function showNewCustomerForm(phoneFallback) {
  matchedCustomer = null;
  showPage('newcustomer');
  let val = phoneFallback.replace(/[^0-9]/g, '');
  if (val.length === 11) val = val.substring(0,3) + '-' + val.substring(3,7) + '-' + val.substring(7,11);
  else if (val.length === 10) val = val.substring(0,3) + '-' + val.substring(3,6) + '-' + val.substring(6,10);
  document.getElementById('reg-phone').value = val;
  document.getElementById('reg-name').focus();
}

function calcDiscount() {
  const amtStr = document.getElementById('reg-amount').value;
  const preview = document.getElementById('discount-preview');
  if(!amtStr) { preview.style.display = 'none'; return; }
  const origin = parseInt(amtStr);
  const discount = origin * 0.2;
  const final = origin - discount;
  document.getElementById('orig-amt').textContent = formatMoney(origin);
  document.getElementById('disc-amt').textContent = '-' + formatMoney(discount);
  document.getElementById('final-amt').textContent = formatMoney(final);
  preview.style.display = 'flex';
}

function registerCustomer() {
  const phone = document.getElementById('reg-phone').value;
  const name = document.getElementById('reg-name').value;
  const region = document.getElementById('reg-region').value;
  const gender = document.getElementById('reg-gender').value;
  const age = document.getElementById('reg-age').value;
  const amt = document.getElementById('reg-amount').value;
  
  if(!name || !phone || !region || !gender || !amt) { showToast('필수 항목(*)을 모두 입력해주세요.'); return; }
  
  const final = parseInt(amt) * 0.8;
  const today = new Date().toISOString().split('T')[0];
  const newC = { Phone: phone, Name: name, Region: region, AgeGroup: age || null, Gender: gender, JoinDate: today };
  
  const cData = getCustomers();
  if(cData.find(c => c.Phone === phone)) { showToast('이미 등록된 번호입니다.'); return; }
  
  cData.push(newC);
  saveCustomers(cData);
  
  const vData = getVisits();
  vData.push({ VisitID: 'V' + Date.now().toString().slice(-6), Phone: phone, VisitDate: today, SpendAmount: final, IsFirstVisit: true });
  saveVisits(vData);
  
  showToast(`🎉 ${name}님 신규 등록 완료! (20% 할인 적용)`);
  resetRegisterForm();
  updateTodayList();
}

function addVisit() {
  const amt = document.getElementById('exist-amount').value;
  if(!amt) { showToast('결제 금액을 입력해주세요.'); return; }
  const today = new Date().toISOString().split('T')[0];
  const vData = getVisits();
  vData.push({ VisitID: 'V' + Date.now().toString().slice(-6), Phone: matchedCustomer.Phone, VisitDate: today, SpendAmount: parseInt(amt), IsFirstVisit: false });
  saveVisits(vData);
  showToast(`✅ ${matchedCustomer.Name}님 결제 처리 완료!`);
  resetRegisterForm();
  updateTodayList();
}

function resetRegisterForm() {
  ['lookup-phone', 'reg-name', 'reg-phone', 'reg-amount', 'exist-amount'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  const res = document.getElementById('lookup-result'); if(res) res.innerHTML = '';
  const exist = document.getElementById('existing-payment'); if(exist) exist.style.display = 'none';
  const preview = document.getElementById('discount-preview'); if(preview) preview.style.display = 'none';
  matchedCustomer = null;
}

function updateTodayList() {
  const todayStr = new Date().toISOString().split('T')[0];
  const tVisits = getVisits().filter(v => v.VisitDate === todayStr);
  document.querySelectorAll('#today-badge').forEach(el => el.textContent = `${tVisits.length}건`);
  const list = document.getElementById('today-list');
  if (list) {
    list.innerHTML = tVisits.length === 0 ? '<div class="empty-state">오늘 방문 내역이 없습니다</div>' :
      [...tVisits].reverse().map(v => {
        const c = getCustomers().find(x => x.Phone === v.Phone);
        return `
          <div class="today-item">
            <div class="t-info"><h4>${c ? c.Name : '알수없음'}</h4><p>${v.Phone}</p></div>
            <div class="t-amt ${v.IsFirstVisit ? 'new' : ''}">
              ${v.IsFirstVisit ? '<span style="font-size:10px; color:var(--accent-gold); border:1px solid; padding:1px 4px; border-radius:4px; margin-right:5px;">신규20%</span>' : ''}${formatMoney(v.SpendAmount)}
            </div>
          </div>`;
      }).join('');
  }
}

// ===== 5. 유틸리티 & 네비게이션 =====

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
  const p = document.getElementById('page-' + pageId); if (p) p.classList.add('active');
  const n = document.getElementById('nav-' + pageId); if (n) n.classList.add('active');
  
  const titleMap = { 
    'dashboard': '📊 경영 데시보드', 
    'customers': '👥 고객 분석 관리', 
    'visits': '🧾 전체 방문 목록', 
    'targeting': '🎯 전략적 타겟팅', 
    'newcustomer': '➕ POS 결제 등록', 
    'admin': '💳 유료 유저 승인 관리',
    'settings': '⚙️ 가게 경영 환경설정' 
  };
  document.getElementById('page-title').textContent = titleMap[pageId] || '관리 시스템';
  if(window.innerWidth <= 768) toggleSidebar();
  
  if(pageId === 'dashboard') updateDashboard();
  if(pageId === 'customers') filterCustomers(currentFilter);
  if(pageId === 'visits') updateVisitsPage();
  if(pageId === 'targeting') updateTargetingPage();
  if(pageId === 'newcustomer') updateTodayList();
  if(pageId === 'revenue') updateRevenuePage();
  if(pageId === 'admin') updateAdminPage();
}

// ===== 환경설정 저장 (Goal 3 대응) =====
async function saveConfig() {
  const storeName = document.getElementById('config-store-name').value;
  const senderNumber = document.getElementById('config-sender').value;
  const apiKey = document.getElementById('config-api-key').value;
  const apiSecret = document.getElementById('config-api-secret').value;

  if(!storeName || !senderNumber) {
    showToast('가게 이름과 발신 번호는 필수입니다.');
    return;
  }

  // 1. 전역 상태 업데이트
  dbConfig.storeName = storeName;
  dbConfig.senderNumber = senderNumber;
  dbConfig.apiKey = apiKey;
  dbConfig.apiSecret = apiSecret;

  // 2. 서버 저장
  showToast('설정 저장 중... ⏳');
  await persistData({ config: dbConfig });
  showToast('✅ 환경설정이 저장되었습니다.');

  // 3. UI 즉시 반영 (사이드바 프로필 등)
  syncData(); 
}

// ===== 날짜별 매출 분석 로직 =====
function updateRevenuePage() {
  const visits = getVisits();
  if (!visits || visits.length === 0) {
    document.getElementById('revenue-list').innerHTML = '<div class="empty-state">매출 내역이 없습니다.</div>';
    return;
  }

  // 날짜별 그룹화
  const grouped = {};
  visits.forEach(v => {
    if (!grouped[v.VisitDate]) grouped[v.VisitDate] = { total: 0, items: [] };
    grouped[v.VisitDate].total += v.SpendAmount;
    grouped[v.VisitDate].items.push(v);
  });

  // 날짜 역순 정렬
  const dates = Object.keys(grouped).sort((a,b) => new Date(b) - new Date(a));
  const listEl = document.getElementById('revenue-list');
  listEl.innerHTML = '';

  dates.forEach((date, idx) => {
    const item = grouped[date];
    const isToday = date === new Date().toISOString().split('T')[0];
    
    const el = document.createElement('div');
    el.className = `rev-item ${idx === 0 ? 'active' : ''}`;
    el.innerHTML = `
      <div class="r-date">${date} ${isToday ? '<span class="badge" style="background:var(--accent-blue)">오늘</span>' : ''}</div>
      <div class="r-total">${formatMoney(item.total)}</div>
    `;
    el.onclick = () => {
      document.querySelectorAll('.rev-item').forEach(r => r.classList.remove('active'));
      el.classList.add('active');
      showRevenueDetail(date, item);
    };
    listEl.appendChild(el);

    // 첫 번째 날짜(가장 최근) 상세 내역 자동 표시
    if (idx === 0) showRevenueDetail(date, item);
  });
}

function showRevenueDetail(date, data) {
  const card = document.getElementById('revenue-detail-card');
  card.style.display = 'block';
  document.getElementById('revenue-detail-title').textContent = `📅 ${date} 상세 매출 내역 (${data.items.length}건)`;
  document.getElementById('revenue-detail-total').textContent = formatMoney(data.total);

  const tb = document.getElementById('revenue-detail-tbody');
  const customers = getCustomers();
  tb.innerHTML = '';
  
  data.items.sort((a,b) => b.VisitID.localeCompare(a.VisitID)).forEach(item => {
    const c = customers.find(x => x.Phone === item.Phone);
    tb.innerHTML += `
      <tr>
        <td><small style="color:var(--text-muted)">${item.VisitID}</small></td>
        <td><strong>${c ? c.Name : '알수없음'}</strong></td>
        <td>${item.Phone}</td>
        <td style="color:var(--accent-success); font-weight:bold;">${formatMoney(item.SpendAmount)}</td>
      </tr>
    `;
  });
}

// ===== 마스터 관리자 기능 =====
async function updateAdminPage() {
  try {
    const res = await fetch('/api/admin/owners');
    const data = await res.json();
    if (data.success) {
      document.getElementById('admin-owner-count').textContent = `전체 ${data.owners.length}명`;
      const tb = document.getElementById('admin-owners-tbody');
      tb.innerHTML = '';
      data.owners.forEach(owner => {
        const isAdmin = owner.email === 'shsh3@naver.com';
        const statusClass = owner.status.toLowerCase(); // active, pending, expired
        const rowClass = `row-${statusClass}`;
        
        tb.innerHTML += `
          <tr class="${rowClass}">
            <td>${owner.joinDate}</td>
            <td><strong>${owner.storeName}</strong></td>
            <td>${owner.email}</td>
            <td>${owner.name || '-'}</td>
            <td><span class="status-badge ${statusClass}">${owner.status}</span></td>
            <td>
              ${isAdmin ? '<small style="color:#666">마스터</small>' : `
                <div style="display:flex; gap:5px;">
                  <button class="action-sm-btn" onclick="updateOwnerStatus('${owner.id}', 'Active')" style="background:var(--accent-gold); border:none; color:#050b18; padding:4px 10px; font-weight:bold;">승인</button>
                  <button class="action-sm-btn" onclick="updateOwnerStatus('${owner.id}', 'Pending')" style="background:none; border:1px solid #666; color:#94a3b8; padding:4px 10px;">대기</button>
                  <button class="action-sm-btn" onclick="updateOwnerStatus('${owner.id}', 'Expired')" style="background:none; border:1px solid var(--accent-danger); color:var(--accent-danger); padding:4px 10px;">중지</button>
                </div>
              `}
            </td>
          </tr>
        `;
      });
    }
  } catch(e) {
    showToast('관리자 정보를 불러오지 못했습니다.');
  }
}

async function updateOwnerStatus(targetOwnerId, newStatus) {
  if (!confirm(`사장님 상태를 '${newStatus}'로 변경하시겠습니까?`)) return;
  
  try {
    const res = await fetch('/api/admin/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOwnerId, status: newStatus })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`✅ ${newStatus} 처리 완료!`);
      updateAdminPage();
    }
  } catch(e) {
    showToast('상태 변경 실패');
  }
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => { t.style.animation = 'toastOut 0.3s forwards'; setTimeout(() => t.remove(), 300); }, 3500);
}

function animateValue(id, start, end, duration) {
  let obj = document.getElementById(id); if (!obj) return;
  if (start === end) { obj.innerHTML = end.toLocaleString(); return; }
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString();
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ===== 초기화 =====
window.onload = async () => {
  if (currentOwnerId) {
    document.body.classList.add('authenticated');
    syncData();
  } else {
    document.body.classList.remove('authenticated');
  }
  setInterval(() => {
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('ko-KR', { 
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' 
    });
  }, 1000);
};
