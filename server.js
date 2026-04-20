const express = require('express');
const cors = require('cors');
const { msg } = require('coolsms-node-sdk');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'bypass-tunnel-reminder']
}));
app.use(express.json());

// Supabase 클라이언트 초기화
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${req.method} ${req.url}`);
  next();
});

// 정적 파일 호스팅
app.use(express.static(path.join(__dirname)));

// 1. 데이터 로드 API
app.post('/api/data/load', async (req, res) => {
  try {
    const { ownerId } = req.body;
    if (!ownerId) return res.status(400).json({ success: false, message: 'OwnerID가 필요합니다.' });

    console.log(`🔍 [${ownerId}] 데이터 불러오는 중...`);

    // 병렬로 여러 테이블 데이터 조회
    const [
      { data: customers, error: custErr },
      { data: visits, error: visitErr },
      { data: config, error: confErr },
      { data: owner, error: ownerErr }
    ] = await Promise.all([
      supabase.from('customers').select('*').eq('owner_id', ownerId),
      supabase.from('visits').select('*').eq('owner_id', ownerId),
      supabase.from('config').select('*').eq('owner_id', ownerId).single(),
      supabase.from('owners').select('*').eq('id', ownerId).single()
    ]);

    if (custErr || visitErr) throw (custErr || visitErr);

    // 프론트엔드 형식에 맞게 변환 (snake_case -> CamelCase)
    const formattedCustomers = (customers || []).map(c => ({
      Phone: c.phone,
      Name: c.name,
      Region: c.region,
      BirthYear: c.birth_year,
      Gender: c.gender,
      JoinDate: c.join_date,
      ownerId: c.owner_id,
      manualEntry: c.manual_entry || {}
    }));

    const formattedVisits = (visits || []).map(v => ({
      VisitID: v.visit_id,
      Phone: v.phone,
      VisitDate: v.visit_date,
      SpendAmount: v.spend_amount,
      IsFirstVisit: v.is_first_visit,
      ownerId: v.owner_id
    }));

    res.json({ 
      success: true, 
      data: {
        customers: formattedCustomers,
        visits: formattedVisits,
        config: {
          storeName: config?.store_name || '매장',
          senderNumber: config?.sender_number || '',
          apiKey: config?.api_key || '',
          api_secret: config?.api_secret || ''
        },
        owner: owner
      }
    });
  } catch(e) {
    console.error('❌ 데이터 로드 실패:', e.message);
    res.status(500).json({ success: false, message: '데이터를 읽을 수 없습니다.' });
  }
});

// 2. 데이터 저장 API
app.post('/api/data/save', async (req, res) => {
  try {
    const { ownerId, customers, visits, config } = req.body;
    if (!ownerId) return res.status(400).json({ success: false, message: 'OwnerID가 필요합니다.' });

    console.log(`💾 [${ownerId}] 데이터 저장 중...`);

    // 고객 데이터 업서트
    if (customers) {
      const dbCusts = customers.map(c => ({
        phone: c.Phone,
        name: c.Name,
        region: c.Region,
        birth_year: c.BirthYear,
        gender: c.Gender,
        join_date: c.JoinDate,
        owner_id: ownerId,
        manual_entry: c.manualEntry || {}
      }));
      const { error } = await supabase.from('customers').upsert(dbCusts);
      if (error) throw error;
    }

    // 방문 데이터 업서트
    if (visits) {
      const dbVisits = visits.map(v => ({
        visit_id: v.VisitID,
        phone: v.Phone,
        visit_date: v.VisitDate,
        spend_amount: v.SpendAmount,
        is_first_visit: v.is_first_visit,
        owner_id: ownerId
      }));
      const { error } = await supabase.from('visits').upsert(dbVisits);
      if (error) throw error;
    }

    // 설정 데이터 업서트
    if (config) {
      const dbConfig = {
        owner_id: ownerId,
        store_name: config.storeName,
        sender_number: config.senderNumber,
        api_key: config.apiKey,
        api_secret: config.apiSecret
      };
      const { error } = await supabase.from('config').upsert(dbConfig);
      if (error) throw error;
    }

    res.json({ success: true });
  } catch(e) {
    console.error('❌ 데이터 저장 실패:', e.message);
    res.status(500).json({ success: false, message: '데이터를 저장할 수 없습니다.' });
  }
});

// 3. 로그인 API
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data: owner, error } = await supabase
      .from('owners')
      .select('*')
      .eq('email', email)
      .eq('password', password)
      .single();

    if (error || !owner) {
      return res.json({ success: false, message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
    }

    if (owner.status === 'Expired') {
      return res.json({ success: false, message: '구독 기간이 만료되었습니다. 관리자에게 문의하세요.' });
    }

    res.json({ success: true, ownerId: owner.id, storeName: owner.store_name });
  } catch (e) {
    res.status(500).json({ success: false, message: '로그인 도중 오류가 발생했습니다.' });
  }
});

// 4. 회원가입 API
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, name, storeName } = req.body;

    // 중복 체크
    const { data: existing } = await supabase.from('owners').select('id').eq('email', email).single();
    if (existing) {
      return res.json({ success: false, message: '이미 가입된 이메일입니다.' });
    }

    // 새 ID 생성 (간단하게)
    const { data: allOwners } = await supabase.from('owners').select('id');
    const newId = 'owner_' + (allOwners.length + 1);

    const { error } = await supabase.from('owners').insert({
      id: newId,
      email,
      password,
      store_name: storeName,
      status: 'Pending'
    });

    if (error) throw error;
    res.json({ success: true, message: '가입 신청이 완료되었습니다. 관리자 승인 후 이용 가능합니다.' });
  } catch (e) {
    res.status(500).json({ success: false, message: '가입 도중 오류가 발생했습니다.' });
  }
});

// 5. 문자 발송 API
app.post('/send-sms', async (req, res) => {
  const { targets, text, config } = req.body; 
  if (!targets || targets.length === 0 || !text) return res.status(400).json({ success: false, message: '데이터 부족' });

  msg.init({ apiKey: config.apiKey, apiSecret: config.apiSecret });
  const messageList = targets.map(t => ({
    to: t.phone.replace(/-/g, ''), 
    from: config.senderNumber,
    text: text.replace(/\[이름\]/g, t.name) 
  }));

  try {
    if (config.apiKey === 'YOUR_API_KEY' || config.apiKey === '') {
      return res.json({ success: true, message: '시뮬레이션 성공' });
    }
    const result = await msg.send(messageList);
    res.json({ success: true, message: '발송 성공', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: '발송 실패', error: error.message });
  }
});

// 서버 구동
const PORT = process.env.PORT || 3060;
app.listen(PORT, () => {
  console.log(`\n🚀 [클라우드 기반 서버 구동 완료]`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
