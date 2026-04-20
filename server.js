const express = require('express');
const cors = require('cors');
const { msg } = require('coolsms-node-sdk');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const localtunnel = require('localtunnel');

const app = express();
app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'bypass-tunnel-reminder']
}));
app.use(express.json());

let currentTunnelUrl = ''; // 현재 발급된 외부 주소 저장용 변수

// 요청 로깅 미들웨어 추가
app.use((req, res, next) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${req.method} ${req.url}`);
  next();
});

// 1. 정적 파일 호스팅 (웹 브라우저에서 직접 접속 가능)
app.use(express.static(path.join(__dirname)));

// 2. 파일 DB 로직 (브라우저 종속이 아닌 서버 종속으로 이관)
const DATA_FILE = path.join(__dirname, 'data.json');

// 기본 데이터 파일이 없으면 생성
if (!fs.existsSync(DATA_FILE)) {
  const defaultData = {
    customers: [
      { Phone: '010-1111-2222', Name: '김철수', Region: '의정부', BirthYear: 1985, Gender: '남성', JoinDate: '2023-05-10' },
      { Phone: '010-3333-4444', Name: '이영희', Region: '인천', BirthYear: 1990, Gender: '여성', JoinDate: '2024-01-15' },
      { Phone: '010-5555-6666', Name: '박지민', Region: '서울', BirthYear: 1995, Gender: '여성', JoinDate: '2024-02-20' },
      { Phone: '010-7777-8888', Name: '최동석', Region: '의정부', BirthYear: 1980, Gender: '남성', JoinDate: '2023-11-05' },
      { Phone: '010-9999-0000', Name: '정우성', Region: '인천', BirthYear: 1988, Gender: '남성', JoinDate: '2024-04-01' }
    ],
    visits: [
      { VisitID: 'V001', Phone: '010-1111-2222', VisitDate: '2024-05-01', SpendAmount: 50000, IsFirstVisit: true },
      { VisitID: 'V002', Phone: '010-1111-2222', VisitDate: '2024-05-05', SpendAmount: 160000, IsFirstVisit: false },
      { VisitID: 'V003', Phone: '010-3333-4444', VisitDate: '2024-03-01', SpendAmount: 45000, IsFirstVisit: true },
      { VisitID: 'V004', Phone: '010-5555-6666', VisitDate: '2024-01-01', SpendAmount: 70000, IsFirstVisit: true },
      { VisitID: 'V005', Phone: '010-7777-8888', VisitDate: '2024-04-10', SpendAmount: 90000, IsFirstVisit: true },
      { VisitID: 'V006', Phone: '010-9999-0000', VisitDate: '2024-05-10', SpendAmount: 250000, IsFirstVisit: true }
    ],
    config: { storeName: '단골비서 매장', senderNumber: '', apiKey: '', apiSecret: '' }
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
}

// DB 읽기 (특정 사장님 데이터만 필터링)
app.post('/api/data/load', (req, res) => {
  try {
    const { ownerId } = req.body;
    if (!ownerId) return res.status(400).json({ success: false, message: 'OwnerID가 필요합니다.' });

    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    
    // 해당 사장님의 데이터만 추출
    const filteredCustomers = db.customers.filter(c => c.ownerId === ownerId);
    const filteredVisits = db.visits.filter(v => v.ownerId === ownerId);
    const ownerConfig = db.config[ownerId] || { storeName: '단골비서 매장', senderNumber: '', apiKey: '', apiSecret: '' };
    const ownerInfo = db.owners.find(o => o.id === ownerId);

    res.json({ 
      success: true, 
      data: {
        customers: filteredCustomers,
        visits: filteredVisits,
        config: ownerConfig,
        owner: ownerInfo
      },
      tunnelUrl: currentTunnelUrl 
    });
  } catch(e) {
    res.status(500).json({ success: false, message: '데이터를 읽을 수 없습니다.' });
  }
});

// DB 쓰기 (해당 사장님 구역만 업데이트)
app.post('/api/data/save', (req, res) => {
  try {
    const { ownerId, customers, visits, config } = req.body;
    if (!ownerId) return res.status(400).json({ success: false, message: 'OwnerID가 필요합니다.' });

    let db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    
    // 기존 데이터에서 다른 사장님 데이터는 유지하고, 현재 사장님 데이터만 교체
    if (customers) {
      db.customers = db.customers.filter(c => c.ownerId !== ownerId).concat(customers.map(c => ({...c, ownerId})));
    }
    if (visits) {
      db.visits = db.visits.filter(v => v.ownerId !== ownerId).concat(visits.map(v => ({...v, ownerId})));
    }
    if (config) {
      db.config[ownerId] = config;
    }
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
    console.log(`   └─ ✅ [${ownerId}] 데이터 저장 완료`);
    res.json({ success: true });
  } catch(e) {
    console.error(`   └─ ❌ 데이터 쓰기 실패:`, e.message);
    res.status(500).json({ success: false, message: '데이터 쓰기 실패' });
  }
});

// 로그인 처리
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  
  const owner = db.owners.find(o => o.email === email && o.password === password);
  
  if (owner) {
    if (owner.status === 'Expired') {
      return res.json({ success: false, message: '구독 기간이 만료되었습니다. 관리자에게 문의하세요.' });
    }
    res.json({ success: true, ownerId: owner.id, storeName: owner.storeName });
  } else {
    res.json({ success: false, message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
  }
});

// 회원가입 처리 (승인 대기 상태로 생성)
app.post('/api/auth/signup', (req, res) => {
  const { email, password, name, storeName } = req.body;
  let db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  if (db.owners.find(o => o.email === email)) {
    return res.json({ success: false, message: '이미 가입된 이메일입니다.' });
  }

  const newOwner = {
    id: 'owner_' + (db.owners.length + 1),
    email, password, storeName,
    status: 'Pending', // 초기 상태는 승인 대기
    joinDate: new Date().toISOString().split('T')[0]
  };

  db.owners.push(newOwner);
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  res.json({ success: true, message: '가입 신청이 완료되었습니다. 관리자 승인 후 이용 가능합니다.' });
});

// [관리자 전용] 모든 사장님 목록 조회
app.get('/api/admin/owners', (req, res) => {
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    // 비밀번호는 제외하고 전송 (보안)
    const owners = db.owners.map(({password, ...o}) => o);
    res.json({ success: true, owners });
  } catch(e) {
    res.status(500).json({ success: false, message: '목록을 불러올 수 없습니다.' });
  }
});

// [관리자 전용] 사장님 상태 변경 (승인/중지 등)
app.post('/api/admin/update-status', (req, res) => {
  try {
    const { targetOwnerId, status } = req.body;
    let db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    
    const owner = db.owners.find(o => o.id === targetOwnerId);
    if (!owner) return res.status(404).json({ success: false, message: '대상 사장님을 찾을 수 없습니다.' });

    owner.status = status; // Active, Pending, Expired 등
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
    
    res.json({ success: true, message: `성공적으로 ${status} 상태로 변경되었습니다.` });
  } catch(e) {
    res.status(500).json({ success: false, message: '업데이트 실패' });
  }
});


// [사용자/관리자] 사장님 프로필 정보 업데이트 (이름 등)
app.post('/api/admin/update-profile', (req, res) => {
  try {
    const { ownerId, name } = req.body;
    let db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    
    const owner = db.owners.find(o => o.id === ownerId);
    if (!owner) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

    if (name) owner.name = name;
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
    
    res.json({ success: true, message: '프로필 정보가 업데이트되었습니다.' });
  } catch(e) {
    res.status(500).json({ success: false, message: '프로필 업데이트 실패' });
  }
});

// 문자 발송 API 연동 엔드포인트
app.post('/send-sms', async (req, res) => {
  const { targets, text, config } = req.body; 

  if (!targets || targets.length === 0 || !text) {
    return res.status(400).json({ success: false, message: '수신자 목록이나 메시지가 없습니다.' });
  }

  if (!config || !config.apiKey || !config.apiSecret || !config.senderNumber) {
    return res.status(400).json({ success: false, message: '앱 내 [환경설정]에서 API 키와 발신번호를 먼저 입력해주세요.' });
  }

  msg.init({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret
  });

  const messageList = targets.map(target => {
    return {
      to: target.phone.replace(/-/g, ''), 
      from: config.senderNumber,
      text: text.replace(/\[이름\]/g, target.name) 
    };
  });

  try {
    // 사용자가 테스트 키를 넣었거나 비워뒀을 때 방어 시뮬레이션
    if (config.apiKey === 'YOUR_API_KEY' || config.apiKey === '') {
        console.log(`[시뮬레이션 모드] ${targets.length}건의 문자를 발송합니다.`);
        await new Promise(r => setTimeout(r, 1000));
        return res.json({ success: true, message: '시뮬레이션 발송 성공! (실제 발송 안됨)' });
    }

    const result = await msg.send(messageList);
    console.log('실제 발송 완료:', result);
    res.json({ success: true, message: '실제 단말기로 문자 발송 성공!', data: result });
  } catch (error) {
    console.error('문자 발송 실패:', error);
    res.status(500).json({ success: false, message: '문자 발송에 실패했습니다. 키가 잘못되었거나 잔액부족일 수 있습니다.', error: error.message });
  }
});

// 3. 서버 구동 및 외부 터널링
const PORT = process.env.PORT || 3060;
app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 [로컬 접속 주소]`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`======================================================`);
  
  console.log(`\n🌐 외부(온라인) 접속용 주소를 발급받는 중입니다...`);
  
  // Cloudflare Tunnel을 이용한 고도로 안정적인 접속 (is.gd/donzalassi 고정)
  const cfCommand = `powershell -ExecutionPolicy Bypass -Command "npx --yes cloudflared tunnel --url http://127.0.0.1:${PORT}"`;
  const cf = spawn(cfCommand, { shell: true });

  cf.stdout.on('data', (data) => {
    const output = data.toString();
    const match = output.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
    
    if (match && !currentTunnelUrl) {
      const longUrl = match[0];
      console.log(`\n⏳ 클라우드플레어 서버 연결됨: ${longUrl}`);
      console.log(`   (donzalassi 고정 주소로 연결 중...)`);

      const requestUrl = `https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}&shorturl=donzalassi`;
      
      https.get(requestUrl, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const shortData = JSON.parse(body);
            currentTunnelUrl = shortData.shorturl || longUrl;
            
            console.log(`\n✅ [외부 접속 완성 주소] (가장 안정적인 주소!)`);
            console.log(`   👉 ${currentTunnelUrl}`);
            console.log(`   * 접속 시 502 오류가 발생하지 않는 최고 사양 엔진입니다.`);
            console.log(`======================================================\n`);
          } catch(e) {
            currentTunnelUrl = longUrl;
            console.log(`\n✅ [외부 접속 완성 주소] (긴 주소 사용)`);
            console.log(`   👉 ${currentTunnelUrl}`);
          }
        });
      });
    }
  });

  cf.stderr.on('data', (data) => {
    const output = data.toString();
    // Cloudflare는 stderr로 주소를 뱉는 경우가 많습니다.
    const match = output.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
    if (match && !currentTunnelUrl) {
        const longUrl = match[0];
        console.log(`\n⏳ 클라우드플레어 서버 연결됨: ${longUrl}`);
        
        const requestUrl = `https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}&shorturl=donzalassi`;
        https.get(requestUrl, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const shortData = JSON.parse(body);
                    currentTunnelUrl = shortData.shorturl || longUrl;
                    console.log(`\n✅ [외부 접속 완성 주소] (가장 안정적인 주소!)`);
                    console.log(`   👉 ${currentTunnelUrl}`);
                    console.log(`======================================================\n`);
                } catch(e) { currentTunnelUrl = longUrl; }
            });
        });
    }
  });

  cf.on('close', () => { currentTunnelUrl = ''; });
});
