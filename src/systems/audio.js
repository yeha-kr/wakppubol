// 공용 사운드 시스템 (P1 신설, P2 확장 — CLAUDE.md 5장, docs/PLAN.md 7장)
// - 모든 사운드 재생은 이 모듈만 사용한다 (씬에서 this.sound.play 직접 호출 금지)
// - 원샷: 샘플 풀 + 라운드로빈(같은 샘플 연속 금지) + playbackRate ±10% + 볼륨 ±20% 랜덤
// - 루프: startLoop()/stopLoop()로 관리 (반죽 루프처럼 볼륨을 실시간 제어하는 소리)
// - public/assets/sfx에 파일이 있으면 로드, 없으면 Web Audio 노이즈를 오프라인 합성해
//   자동 대체. 합성 버퍼도 Phaser 오디오 캐시에 넣기 때문에 실제 파일과 완전히 같은
//   경로(사전 디코딩된 버퍼 재생)로 발음된다 → 지연 최소화
// - iOS 정책: 언락(AudioContext running) 전에는 어떤 재생도 시도하지 않는다

const SFX_DIR = 'assets/sfx/';

// 원샷 풀 구성: docs/PLAN.md 7.2·9.2 + P1/P2 명세의 파일 목록
const MANIFEST = {
  crack_small: ['crack_small_1', 'crack_small_2', 'crack_small_3'],
  crack_mid: ['crack_mid_1', 'crack_mid_2'],
  crack_big: ['crack_big_1', 'crack_big_2'],
  shard: ['shard_1', 'shard_2'],
  clay_tear: ['clay_tear_1', 'clay_tear_2', 'clay_tear_3'],
  wax_dip: ['wax_dip'],
  wax_drip: ['wax_drip_1', 'wax_drip_2', 'wax_drip_3'],
  wax_fail: ['wax_fail'],
  rubber_pat: ['rubber_pat_1', 'rubber_pat_2', 'rubber_pat_3'],
  tie_tick: ['tie_tick'],
  tie_zip: ['tie_zip'],
};

// 루프 사운드 구성 (풀이 아니라 단일 파일, 인스턴스 1개를 계속 재생하며 볼륨 제어)
const LOOP_MANIFEST = {
  knead_loop: 'knead_loop',
};

// 합성 대체음 레시피: 풀별 질감 (freq는 밴드패스 중심 범위 Hz, 시간은 초)
const SYNTH_RECIPE = {
  crack_small: { variants: 3, duration: 0.09, bursts: 1, freq: [3200, 5200], q: 0.9, decay: 0.028, peak: 0.5 },
  crack_mid: { variants: 2, duration: 0.17, bursts: 3, freq: [2200, 3800], q: 1.0, decay: 0.035, peak: 0.55 },
  crack_big: { variants: 2, duration: 0.3, bursts: 5, freq: [700, 2200], q: 0.8, decay: 0.06, peak: 0.7 },
  shard: { variants: 2, duration: 0.12, bursts: 2, freq: [3600, 5600], q: 1.2, decay: 0.03, peak: 0.32 },
  // 뜯기: 촘촘한 마이크로 버스트로 "북— 찢어지는" 질감을 흉내낸다
  clay_tear: { variants: 3, duration: 0.22, bursts: 5, freq: [900, 2200], q: 0.7, decay: 0.045, peak: 0.5 },
  // 첨벙: 낮은 대역의 묵직한 "퐁" (담글 때)
  wax_dip: { variants: 1, duration: 0.28, bursts: 3, freq: [250, 600], q: 1.4, decay: 0.09, peak: 0.55 },
  // 방울: 높은 Q로 공진시킨 "똑" (뺄 때 드립)
  wax_drip: { variants: 3, duration: 0.12, bursts: 1, freq: [1300, 2600], q: 5, decay: 0.05, peak: 0.4 },
  // 실패: 낮고 둔탁한 "철퍽" (얼룩)
  wax_fail: { variants: 1, duration: 0.35, bursts: 2, freq: [180, 420], q: 0.9, decay: 0.13, peak: 0.6 },
  // 고무 패팅: 낮고 부드러운 "팟"
  rubber_pat: { variants: 3, duration: 0.1, bursts: 1, freq: [300, 700], q: 1.2, decay: 0.045, peak: 0.5 },
  // 래칫 틱: 아주 짧고 높은 "틱" (재생 rate로 피치를 올려가며 사용)
  tie_tick: { variants: 2, duration: 0.05, bursts: 1, freq: [2500, 4000], q: 2.5, decay: 0.015, peak: 0.38 },
  // 조임: 촘촘한 버스트로 "지지익" 긁힘 질감
  tie_zip: { variants: 1, duration: 0.38, bursts: 9, freq: [1100, 2100], q: 1.6, decay: 0.028, peak: 0.5 },
};

const pools = {}; // 원샷 풀명 → { keys: [], last: -1, synthetic: bool }
const loops = {}; // 루프명 → { key, instance, synthetic }
let sm = null; // Phaser 사운드 매니저 (Preload에서 설정)

// 언락(재생 가능) 상태인지 — context가 없는 매니저는 locked 플래그로 판단
function isRunning() {
  if (!sm) return false;
  const ctx = sm.context;
  return ctx ? ctx.state === 'running' : sm.locked === false;
}

// Preload 씬에서 1회 호출. 존재 확인 → 로드 → 부족한 풀은 합성 대체.
// 어떤 실패에도 throw하지 않는다 (로드 문제로 게임이 죽으면 안 됨 — CLAUDE.md 6장)
export async function loadSfx(scene) {
  sm = scene.sound;
  const summary = [];
  try {
    // 1) 파일 존재 확인(HEAD 프로브) — "존재 여부로 자동 분기"를 위한 의도된 요청.
    //    주의: Vite 개발 서버 등 SPA 서버는 없는 파일에도 index.html(200)을 돌려주므로
    //    상태코드만 믿으면 안 되고, Content-Type이 HTML이면 "없음"으로 판정한다.
    //    (정적 호스팅에서는 진짜 404가 떨어지며, 개발자도구에 보이는 404 표시는 정상)
    const probeOne = (name) => {
      const url = `${SFX_DIR}${name}.mp3`;
      return fetch(url, { method: 'HEAD' })
        .then((r) => {
          const ct = (r.headers.get('content-type') || '').toLowerCase();
          return { name, url, ok: r.ok && !ct.includes('text/html') };
        })
        .catch(() => ({ name, url, ok: false }));
    };
    const oneShotNames = Object.values(MANIFEST).flat();
    const loopFiles = Object.values(LOOP_MANIFEST);
    const allNames = [...oneShotNames, ...loopFiles];

    // 0) manifest.json이 있으면 그 목록을 신뢰하고 개별 프로브를 생략한다.
    //    정적 호스팅(GitHub Pages)에서는 없는 파일마다 콘솔에 404가 쌓이므로,
    //    프로브는 manifest가 없을 때의 폴백으로만 쓴다.
    //    (mp3를 추가할 때: manifest.json의 files에 파일명 추가, 또는 manifest 삭제)
    let listed = null;
    try {
      const r = await fetch(`${SFX_DIR}manifest.json`);
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (r.ok && !ct.includes('text/html')) {
        const j = await r.json();
        if (Array.isArray(j.files)) listed = new Set(j.files.map((f) => String(f).replace(/\.mp3$/i, '')));
      }
    } catch (e) {
      listed = null; // manifest 없음/손상 → 프로브 모드
    }

    let found;
    if (listed) {
      found = allNames.filter((n) => listed.has(n)).map((n) => ({ name: n, url: `${SFX_DIR}${n}.mp3` }));
    } else {
      const results = await Promise.all(allNames.map(probeOne));
      found = results.filter((r) => r.ok);
    }

    // 2) 있는 파일만 Phaser 로더로 로드 (로드 완료 시점에 디코딩까지 끝난다)
    if (found.length > 0) {
      for (const f of found) scene.load.audio(f.name, [f.url]);
      await new Promise((resolve) => {
        scene.load.once('complete', resolve);
        scene.load.start();
      });
    }

    // 3) 원샷 풀 구성: 캐시에 실제로 올라간 키만 채용, 하나도 없으면 합성 대체
    for (const [pool, names] of Object.entries(MANIFEST)) {
      const okKeys = names.filter((n) => scene.cache.audio.exists(n));
      if (okKeys.length > 0) {
        pools[pool] = { keys: okKeys, last: -1, synthetic: false };
        summary.push(`${pool} 파일 ${okKeys.length}`);
      } else {
        const keys = await synthPool(scene, pool, SYNTH_RECIPE[pool]);
        pools[pool] = { keys, last: -1, synthetic: true };
        summary.push(`${pool} 합성 ${keys.length}`);
      }
    }

    // 4) 루프 사운드 구성
    for (const [name, file] of Object.entries(LOOP_MANIFEST)) {
      if (scene.cache.audio.exists(file)) {
        loops[name] = { key: file, instance: null, synthetic: false };
        summary.push(`${name} 파일`);
      } else {
        const key = `${name}_syn`;
        try {
          scene.cache.audio.add(key, await renderKneadLoop());
          loops[name] = { key, instance: null, synthetic: true };
          summary.push(`${name} 합성`);
        } catch (e) {
          loops[name] = { key: null, instance: null, synthetic: true }; // 무음 폴백
          summary.push(`${name} 무음`);
        }
      }
    }
  } catch (err) {
    console.warn('[오디오] SFX 로드 중 오류 — 남은 풀은 합성으로 대체:', err);
    for (const [pool, recipe] of Object.entries(SYNTH_RECIPE)) {
      if (!pools[pool] || pools[pool].keys.length === 0) {
        try {
          pools[pool] = { keys: await synthPool(scene, pool, recipe), last: -1, synthetic: true };
        } catch (e) {
          pools[pool] = { keys: [], last: -1, synthetic: true }; // 무음 폴백
        }
      }
    }
    for (const name of Object.keys(LOOP_MANIFEST)) {
      if (!loops[name]) {
        try {
          const key = `${name}_syn`;
          scene.cache.audio.add(key, await renderKneadLoop());
          loops[name] = { key, instance: null, synthetic: true };
        } catch (e) {
          loops[name] = { key: null, instance: null, synthetic: true };
        }
      }
    }
  }
  console.log('[오디오] SFX 준비 완료 —', summary.join(' / '));
}

// 원샷 효과음 재생. pool: 'crack_small' | 'crack_mid' | 'crack_big' | 'shard' | 'clay_tear'
// volume/rate는 기본값에 곱해지는 베이스이며, 여기에 랜덤 변조가 더해진다.
export function playSfx(pool, { volume = 1, rate = 1 } = {}) {
  const p = pools[pool];
  if (!p || p.keys.length === 0) return null;
  if (!isRunning()) return null; // 언락 전 재생 금지 (CLAUDE.md 5장)

  // 라운드로빈: 같은 샘플 연속 재생 금지
  let idx = 0;
  if (p.keys.length > 1) {
    if (p.last < 0) {
      idx = Math.floor(Math.random() * p.keys.length);
    } else {
      idx = Math.floor(Math.random() * (p.keys.length - 1));
      if (idx >= p.last) idx += 1;
    }
  }
  p.last = idx;

  const finalRate = rate * (1 + (Math.random() * 2 - 1) * 0.1); // ±10%
  const finalVol = Math.min(1, Math.max(0, volume * (1 + (Math.random() * 2 - 1) * 0.2))); // ±20%
  sm.play(p.keys[idx], { rate: finalRate, volume: finalVol });
  return p.keys[idx];
}

// 루프 재생 시작(이미 재생 중이면 기존 인스턴스 반환). 반환된 핸들의 setVolume()으로
// 실시간 볼륨 제어가 가능하다. 언락 전이거나 소스가 없으면 null.
export function startLoop(name, { volume = 0 } = {}) {
  const L = loops[name];
  if (!L || !L.key) return null;
  if (!isRunning()) return null;
  if (L.instance && L.instance.isPlaying) return L.instance;
  L.instance = sm.add(L.key, { loop: true, volume });
  L.instance.play();
  return L.instance;
}

// 루프 정지 + 인스턴스 정리 (페이드아웃은 호출 측에서 볼륨 트윈 후 호출)
export function stopLoop(name) {
  const L = loops[name];
  if (L && L.instance) {
    L.instance.stop();
    L.instance.destroy();
    L.instance = null;
  }
}

// 디버깅·검증용: 풀별 샘플 수와 합성 여부
export function getSfxStatus() {
  const out = {};
  for (const [name, p] of Object.entries(pools)) {
    out[name] = { count: p.keys.length, synthetic: p.synthetic };
  }
  for (const [name, L] of Object.entries(loops)) {
    out[name] = { count: L.key ? 1 : 0, synthetic: L.synthetic, loop: true };
  }
  return out;
}

// ─── 합성 대체음 ───

// 한 풀의 변형들을 오프라인 렌더해 Phaser 오디오 캐시에 등록한다
async function synthPool(scene, pool, recipe) {
  if (typeof OfflineAudioContext === 'undefined') {
    console.warn(`[오디오] OfflineAudioContext 미지원 — ${pool} 무음 처리`);
    return [];
  }
  const keys = [];
  for (let i = 1; i <= recipe.variants; i++) {
    const buffer = await renderBurst(recipe);
    const key = `${pool}_syn_${i}`;
    scene.cache.audio.add(key, buffer);
    keys.push(key);
  }
  return keys;
}

// 노이즈 버스트 1개 렌더 — 얇은 껍질이 갈라지는 "짝/짜자작/와작" 임시 질감
async function renderBurst(recipe) {
  const sr = 44100;
  const dur = recipe.duration;
  const len = Math.max(1, Math.round(dur * sr));
  const off = new OfflineAudioContext(1, len, sr);

  // 공용 백색소음 버퍼
  const noiseBuf = off.createBuffer(1, len, sr);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const [f0, f1] = recipe.freq;
  for (let b = 0; b < recipe.bursts; b++) {
    // 버스트를 앞쪽에 몰아 배치해 즉발 어택 + 잔크랙 질감을 만든다
    const t =
      b === 0 ? 0 : Math.min(dur * 0.75, dur * 0.7 * (b / recipe.bursts) * (0.7 + Math.random() * 0.6));

    const src = off.createBufferSource();
    src.buffer = noiseBuf;

    const bp = off.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f0 + (f1 - f0) * Math.random();
    bp.Q.value = recipe.q;

    const g = off.createGain();
    const peak = recipe.peak * (b === 0 ? 1 : 0.45 + Math.random() * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002); // 앞 무음 없는 즉발 어택 (PLAN 7.4)
    g.gain.exponentialRampToValueAtTime(0.001, t + recipe.decay + Math.random() * 0.02);

    src.connect(bp);
    bp.connect(g);
    g.connect(off.destination);
    src.start(t);
    src.stop(Math.min(dur, t + recipe.decay + 0.05));
  }
  return off.startRendering();
}

// 반죽 루프 렌더 — 질척하게 주무르는 임시 질감 (1.6초, 루프 이음새는 베이스 레벨로 정합)
async function renderKneadLoop() {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('OfflineAudioContext 미지원');
  }
  const sr = 44100;
  const dur = 1.6;
  const len = Math.round(dur * sr);
  const off = new OfflineAudioContext(1, len, sr);

  const noiseBuf = off.createBuffer(1, len, sr);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  const src = off.createBufferSource();
  src.buffer = noiseBuf;
  const lp = off.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  lp.Q.value = 0.8;
  const g = off.createGain();

  // 부드러운 볼록(주무름) 4회. 시작/끝을 같은 베이스 레벨로 맞춰 루프 티를 줄인다
  const base = 0.16;
  g.gain.setValueAtTime(base, 0);
  for (const t of [0.15, 0.55, 0.95, 1.35]) {
    g.gain.linearRampToValueAtTime(0.4 + Math.random() * 0.15, t);
    g.gain.linearRampToValueAtTime(base, Math.min(dur, t + 0.22));
  }
  g.gain.linearRampToValueAtTime(base, dur);

  src.connect(lp);
  lp.connect(g);
  g.connect(off.destination);
  src.start(0);
  return off.startRendering();
}
