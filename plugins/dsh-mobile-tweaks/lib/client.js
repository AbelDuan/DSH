window.__ModuleLoader__.load({ id: "dsh-mobile-tweaks", factory: (require) => {
"use strict";

/*
 * dsh-mobile-tweaks —— 手机端 DSH 合并插件（重建版 2026-10-22）。
 *
 * PART_A = 原 dsh-sidebar-tweaks：小鲸鱼置底、竖屏选会话/点输入框自动收起、状态栏避让
 * PART_B = 原 dsh-ime-submit-guard：输入法合成收尾防自动发送 + 焦点守卫
 *          + 点击发送后自动收起输入法（2026-10-23 新增）
 *
 * 两段各自 IIFE 隔离（7 个同名顶层标识符：NAME/SCAN_INTERVAL_MS/apply/doc/safe/start/state），
 * apply 各自 try/catch，互不牵连。原始源码可追溯：/root/.dsh/plugins/dsh-sidebar-tweaks、
 * /root/.dsh/plugins/dsh-ime-submit-guard。
 */
var PART_A = (function (require) {
"use strict";

/*
 * dsh-sidebar-tweaks —— 手机端 DSH 的三处调整：
 *
 *   1) 把「小鲸鱼」（品牌行）挪到侧边栏最底部，并让「新建会话」紧贴在它上面；
 *   2) 竖屏下点击会话列表里的任意会话后，自动收起侧边栏（横屏不动）；
 *   3) 状态栏避让：顶部内容不被状态栏压住（自校准，见下方说明）。
 *
 * ══ 三条硬约束（改代码前务必先读；违反任意一条都会让 WebUI 白屏）══════════
 *
 * 1. load() 必须在顶层调用，且脚本执行期不得抛异常。宿主是队列式加载器
 *    （window.__ModuleLoader__）：一旦抛异常或注册方式宿主观察不到，队列永不排空，
 *    就不打印 `dsh web:` token 行，folk app 拿不到 token，WebUI 直接打不开。
 * 2. 禁止 MutationObserver：回调里写 DOM 会重新触发自身观察，形成无限微任务循环，
 *    卡在 "Loading plugins..."。用 setInterval 轮询。
 * 3. apply() 不得抛异常。调整失效可以接受，打不开 WebUI 不行。
 *
 * ══ 侧边栏真实结构（读 dsh-client-ui-sidebar/lib/client.js 得到）══════════
 *
 *   div.root                    display:flex; flex-direction:column   ← 关键
 *    ├ div._logoRow             ← 鲸鱼在这里：brand > brandIdentity > brandMark(FishLogo)
 *    │                           折叠时同一行内 toggle 按钮里还有 railMark（同样是鲸鱼）
 *    │                           ⚠ 折叠按钮也在这个 logoRow 内，所以它会同鲸鱼一起移动
 *    ├ button._newSession       ← 「新建会话」(IconNewChat)
 *    ├ nav._panelList           ← 面板图标（条件渲染）
 *    ├ div._regionArea          ← 会话列表（flex:1，负责把后面的元素顶到底部）
 *    └ div._footArea
 *       └ div._settingsArea     ← 齿轮（底部固定）
 *
 * 因为根容器本身就是纵向 flex，用 order 重排即可 —— 不需要移动 DOM，
 * 所以 React 重渲染不会把它改回去。_regionArea 保持 flex:1，
 * order 比它大的元素自然被顶到底部。
 *
 * ⚠ 类名带构建哈希（如 hHd-Xa_logoRow），换版本会变。因此一律用
 *   `[class*="_logoRow"]` 这种后缀匹配，而不是写死完整类名。
 *
 * ══ 为什么「收起」要复用应用自己的按钮 ═════════════════════════════════════
 *
 * 折叠状态由 ui-layout 的 store 拥有（sidebar 只是接收 collapsed 属性），外部改不了。
 * 但 layout 的 toggleSidebar 在窄屏下就是翻转 narrowExpanded：
 *
 *     const narrow = viewport < 1024;
 *     toggleSidebar: (d) => {
 *       if (d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded;
 *       else d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? 280 : 0;
 *     }
 *
 * 且 layout 里已有先例：openRightbar 打开右栏时会把 narrowExpanded 置回 false
 * （窄屏自动收起）。但「选择会话」没有这个待遇 —— 这正是本插件补的缺口。
 *
 */

var NAME = 'dsh-sidebar-tweaks';

/* 侧边栏根容器通过「内含 _logoRow」定位，不依赖哈希类名。 */
var LOGO_ROW = '[class*="_logoRow"]';

/*
 * 子元素排序权重（数字越大越靠下）。
 * 顺序由用户指定：鲸鱼与设置对调；顶部图标组下移到「新建会话」与「设置」之间。
 * 自上而下：logoRow(鲸鱼/侧边展开) → newSession(新建会话) → panelList(面板图标) → regionArea(工作区/会话) → footArea(设置)。
 */
var ORDER = [
  [LOGO_ROW, 80],
  ['[class*="_newSession"]', 90],
  ['[class*="_panelList"]', 92],
  ['[class*="_regionArea"]', 10],
  ['[class*="_footArea"]', 100]
];

/* ── 状态栏避让（自校准） ───────────────────────────────────────────────────
 *
 * 背景（都是实测结论，别再靠猜）：
 *   · DSH 自带包里 safe-area-inset / viewport-fit 命中都是 0 —— 宿主不做安全区适配。
 *   · 不加补偿时，会话页标题会压到状态栏下面（截图实测：标题 y≈50，状态栏时钟 y≈88）。
 *   · 无条件按 env(safe-area-inset-top) 补全量时，顶部又会空出一大块 ——
 *     说明 app 其实已经让开了一部分，env() 报的是状态栏全高，直接照补就补多了。
 *
 * 所以这里自校准：只补「env 报的高度」减去「app 已经让开的高度」的差额，
 * 并把结果夹在 [0, env] 区间内 —— 最坏情况退化成"不补"或"补全量"，
 * 不会再出现第三种更糟的结果。
 *
 * app 已让开的高度 ≈ 整屏高 - 视口高 - 底部 inset：
 *   app 完全让开 → chrome ≈ 顶+底 inset → 差额 ≈ 0（不补）
 *   app 完全不让 → chrome ≈ 0            → 差额 = 全量（补满）
 *
 * 另：env() 只有在 viewport meta 带 viewport-fit=cover 时才非 0，故仍需认领 meta。
 */
var VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover';
/*
 * 收起（rail）态的精确重排 —— 层级全部来自 2026-10-18 的 DOM 探针实测：
 *
 *   regionArea > div > root.rail
 *     ├ sectionHeader > headerActions > iconButton    ← 新项目文件夹（5 层）
 *     ├ search > searchButton                          ← 搜索（4 层）
 *     └ listArea 36x665                                ← 吃掉空间的空白块
 *   panelList > panelRow x2                            ← 面板图标
 *
 * 容器级 order 只能整块移动，做不到交错；逐层 display:contents 后叶子成为
 * 根 flex 容器的项，各自 order 才生效。listArea 保持独立并 flex:1 → 空白留在
 * 上方，所有图标自然落到最底部。
 *
 * ⚠ 仅作用于收起态；展开态完全不碰。
 */
var RAIL_CSS = [
  /*
   * 侧边栏重排 —— 全部写在 CSS 里：零 JS 时序、零状态分支。
   *
   * 两条原则（都是踩坑换来的）：
   * 1) 排序必须由 CSS 驱动。JS 走轮询（最多 SCAN_INTERVAL_MS 延迟），状态切换时
   *    会先按旧值渲染一帧再改回来 —— 这就是「切换侧边栏时跳变」的成因。
   * 2) 不按收起/展开做结构性切换。之前只在收起态给 regionArea 打平
   *    (display:contents)，切换时整棵子树从「容器」变「打平」，同样会跳变。
   *    现在只打平 panelList（内部只有 panelRow，两态打平都安全），
   *    regionArea 始终是普通容器 → 切换时结构不变。
   *
   * 层级（自上而下）：
   *   插件(-10) → 工作区区块(10：项目/搜索，顺序跟随系统不干预)
   *   → 空白 → 鲸鱼(80) → 新会话(90) → 自动化任务(92) → 设置(100)
   */
  '[class*="_logoRow"]{order:80 !important}',
  '[class*="_newSession"]{order:90 !important}',
  '[class*="_regionArea"]{order:10 !important}',
  '[class*="_footArea"]{order:100 !important}',
  /* panelList 打平后 panelRow 才是根 flex 项，才能与工作区区块交错排序 */
  '[class*="_panelList"]{display:contents !important}',
  /* 直接子元素即 panelRow；先后由系统注册次序决定 */
  '[class*="_panelList"] > [class*="_panelRow"]:nth-child(1){order:-10 !important}',
  '[class*="_panelList"] > [class*="_panelRow"]:nth-child(2){order:92 !important}',
  /*
   * App 外壳（__dsh_folk_insets__）会给 #root 注入摄像头避让 padding：
   *   #root { padding: 65px 65px 20px 0px !important }
   * 输入法弹出/收起时外壳会重算 insets，padding 在 0 ↔ 65px 之间跳 ——
   * 表现就是「整个会话界面（含输入框）往左移动一下再回来」。
   *
   * 用 html body 前缀把特异性抬到 (1,0,2)，压过外壳的 (1,0,0)；
   * 左右清零（用户明确不需要页面避让摄像头），底部钉 20px（防底栏开合时上下跳）。
   *
   * 顶部不再写死：交给 buildRootCss() 按「进页面时读到一次的系统顶部距离」生成。
   */
  'html body #root{padding-left:0 !important;padding-right:0 !important;padding-bottom:20px !important}'
].join('');

/*
 * 顶部避让：进 WebUI 时读一次「系统真实下发给我们应用的顶部距离」，之后不再重读。
 *
 * 为什么不能写死常量：
 *   App 外壳的 inset 与 statusbar 模块的 dsh_app_top_dp 会共同决定真实值，
 *   写死 65px 在「模块把避让设成 20dp(=80px)」时偏小、在其它配置下又偏大，
 *   两边都对不上，于是顶部要么压状态栏、要么空出一大块。
 *
 * 怎么读：
 *   window.innerHeight 与 documentElement.clientHeight 的差，就是浏览器为
 *   「被顶部遮挡的区域」预留的高度。viewport-fit=cover 下这个差值就是系统
 *   实际下发给本应用的顶部 inset（已扣除外壳让开的部分）。
 *
 * 兜底：差值读不到（<=0，例如外壳已经全让开）时才退回 env(safe-area-inset-top)。
 */
var TOP_INSET_PX = null;      /* null = 还没读；数字 = 已读到的顶部距离 */
var TOP_INSET_ENV = 0;        /* env(safe-area-inset-top) 的兜底值 */

/* 读一次系统顶部距离（只调用一次，见 applyStatusBar）。 */
function readTopInset() {
  var w = typeof window !== 'undefined' ? window : null;
  var d = doc();
  if (!w || !d || !d.documentElement) return;

  /* env() 兜底值：插一个探针元素取 computed padding。 */
  try {
    var probe = d.createElement('div');
    probe.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;' +
      'padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
    (d.body || d.documentElement).appendChild(probe);
    var v = parseFloat(w.getComputedStyle(probe).paddingTop) || 0;
    probe.parentNode.removeChild(probe);
    TOP_INSET_ENV = v;
  } catch (e) { /* ignore */ }

  /* 主值：视口内外高度差 = 系统为本应用预留的顶部区域。 */
  var chrome = 0;
  try {
    var ih = w.innerHeight || 0;
    var ch = d.documentElement.clientHeight || 0;
    chrome = ih - ch;
  } catch (e) { chrome = 0; }

  /* 差值明显为正才认；否则退回 env()。 */
  TOP_INSET_PX = chrome > 0 ? chrome : TOP_INSET_ENV;
}

/* 生成 #root 的顶部 padding 规则（TOP_INSET_PX 未读到时先不下发，避免闪一下）。 */
function buildRootCss() {
  if (TOP_INSET_PX === null) return '';
  return 'html body #root{padding-top:' + TOP_INSET_PX + 'px !important}';
}

/*
 * 收起态两个面板图标的 order。
 *
 * 「搜索 / 工作区文件夹」**故意不设 order**：它们属于工作区浏览器，展开态下必然
 * 位于顶部（regionArea 区块内）。若在收起态把它们排到底部，切换侧边栏开关时这两
 * 个按钮就会在顶部/底部之间跳变 —— 这是用户明确要求消除的问题。
 * 保持不干预后，它们两个状态都在顶部，且 rail 里的 DOM 顺序天然就是
 * 「工作区文件夹 → 搜索」，正好符合用户期望的上下关系。
 */
var RAIL_PANEL_SECOND = '92';   /* panelRow[1] = 自动化任务 */
var RAIL_PANEL_FIRST = '94';    /* panelRow[0] = 插件 */

var SCAN_INTERVAL_MS = 600;
var COLLAPSE_DELAY_MS = 60;

var state = {
  startedAt: 0,
  started: false,
  timer: null,
  viewportOriginal: null,
  cssInjected: false
};

function doc() {
  try {
    return typeof document !== 'undefined' ? document : null;
  } catch (e) {
    return null;
  }
}

/* 包一层，保证回调永远不向外抛。 */
function safe(fn, label) {
  return function () {
    try {
      return fn.apply(this, arguments);
    } catch (error) {
      try { console.warn('[' + NAME + '] ' + label + ': ' + error); } catch (e) { /* ignore */ }
      return undefined;
    }
  };
}

/* ── 需求 1：侧边栏排序 ───────────────────────────────────────────────────── */

/* 侧边栏根 = logoRow 的父元素。 */
function findRoot() {
  var d = doc();
  if (!d) return null;
  try {
    var logo = d.querySelector(LOGO_ROW);
    return logo ? logo.parentElement : null;
  } catch (e) {
    return null;
  }
}

/* 向上追溯到 root 的直接子元素（Tooltip 之类可能包一层）。 */
function directChildOf(root, el) {
  var node = el;
  var guard = 0;
  while (node && node.parentElement !== root && guard++ < 8) node = node.parentElement;
  return node && node.parentElement === root ? node : null;
}

/*
 * 用行内 order 重排。行内样式不会被 React 覆盖（它不写这些子元素的 style），
 * 且元素被重建时轮询会重新补上。只在取值不同时才写，避免无意义的样式失效。
 */
function applyOrder() {
  var root = findRoot();
  if (!root) return false;
  var i;
  for (i = 0; i < ORDER.length; i++) {
    var found = null;
    try {
      found = root.querySelector(ORDER[i][0]);
    } catch (e) {
      found = null;
    }
    if (!found) continue;
    var target = directChildOf(root, found);
    if (!target || !target.style) continue;
    var order = String(ORDER[i][1]);
    if (target.style.order !== order) target.style.order = order;
  }
  return true;
}

/* ── 需求 2：竖屏点会话后收起 ─────────────────────────────────────────────── */

function isPortrait() {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(orientation: portrait)').matches) return true;
      /* matchMedia 已给出明确答案时不再用尺寸兜底，避免与它矛盾。 */
      if (window.matchMedia('(orientation: landscape)').matches) return false;
    }
    if (typeof window !== 'undefined') {
      return window.innerHeight >= window.innerWidth;
    }
  } catch (e) { /* ignore */ }
  return false;
}

/*
 * ui-layout 渲染 data-sidebar-collapsed={sidebarCollapsed || undefined}：
 * 收起时属性存在（="true"），展开时属性被省略。
 */
function isCollapsed() {
  var d = doc();
  if (!d) return true;
  try {
    var el = d.querySelector('[data-sidebar-collapsed]');
    if (!el) return false;
    return el.getAttribute('data-sidebar-collapsed') !== 'false';
  } catch (e) {
    return true;
  }
}

/* 侧边栏自带的折叠按钮（在 logoRow 内）。 */
function findToggle() {
  var d = doc();
  if (!d) return null;
  try {
    var logo = d.querySelector(LOGO_ROW);
    var root = logo ? logo.parentElement : null;
    if (root) {
      var btn = root.querySelector('button[class*="_toggle"]');
      if (btn) return btn;
    }
    return d.querySelector('button[class*="_iconButton"][class*="_toggle"]');
  } catch (e) {
    return null;
  }
}

/*
 * 点击会话后收起侧边栏。
 *
 * 用冒泡阶段挂在 document 上 —— React 的委托监听挂在根容器（document 内部），
 * 所以本监听器在其之后执行，不会抢掉应用自己的「打开会话」处理。
 */
function onDocumentClick(event) {
  try {
    var target = event && event.target;
    if (!target || typeof target.closest !== 'function') return;
    /*
     * 需求：点输入框 与 点会话行 走同一套判断 —— 竖屏 + 侧边栏未收起 时自动收起。
     * 输入框内部命中 [data-lexical-editor]（真正的可编辑区），外层容器是
     * [data-composer-input]，两者都认。
     */
    var onSessionRow = target.closest('[data-row-key^="session:"]');
    var onComposer = target.closest('[data-composer-input]') ||
      target.closest('[data-lexical-editor]');
    if (!onSessionRow && !onComposer) return;
    if (!isPortrait()) return;                                    /* 横屏不动 */
    if (isCollapsed()) return;                                    /* 已收起，再点会展开 */

    setTimeout(safe(function () {
      if (!isPortrait() || isCollapsed()) return;
      var btn = findToggle();
      if (!btn) return;
      btn.click();
    }, 'collapse'), COLLAPSE_DELAY_MS);
  } catch (e) { /* ignore */ }
}

/* ── 状态栏避让 ───────────────────────────────────────────────────────────── */

function viewportMeta() {
  var d = doc();
  if (!d) return null;
  try { return d.querySelector('meta[name="viewport"]'); } catch (e) { return null; }
}

/*
 * 让 viewport meta 常驻 viewport-fit=cover —— 否则 env(safe-area-inset-*) 恒为 0，
 * 后面整套测量都失去意义。相等即返回，反复调用也不会反复写 DOM。
 */
function assertViewport() {
  var meta = viewportMeta();
  if (!meta) return;
  var current = meta.getAttribute('content') || '';
  /*
   * 只在缺少 viewport-fit 时补上，绝不整段覆盖 app 自己的 viewport 设置。
   * 之前强制改写成完整内容，会与 app 形成「它改回、我再改」的反复写入，
   * 布局视口宽度语义反复变化 —— app 据此判断窄/宽，于是侧边栏会在
   * 输入法唤起（触发 resize）时往外弹一下再收回。
   */
  if (current.indexOf('viewport-fit') !== -1) return;
  try {
    meta.setAttribute('content', current ? current + ', viewport-fit=cover' : VIEWPORT_CONTENT);
  } catch (e) { /* ignore */ }
}

/* 布局 frame：侧边栏根之上、类名含 _frame 的祖先；它是承载内边距的正确元素。 */
function findFrame() {
  var d = doc();
  if (!d) return null;
  try {
    var logo = d.querySelector(LOGO_ROW);
    var node = logo ? logo.parentElement : null;
    var guard = 0;
    while (node && guard++ < 12) {
      if (typeof node.className === 'string' && node.className.indexOf('_frame') !== -1) return node;
      node = node.parentElement;
    }
    return d.querySelector('[class*="_frame"]');
  } catch (e) { return null; }
}

function injectCss() {
  var d = doc();
  if (!d || !d.head || typeof d.createElement !== 'function') return;
  try {
    var css = RAIL_CSS + buildRootCss();
    var tag = d.querySelector('style[data-dshsb]');
    if (tag) {
      /* 已注入过：只在内容真的变了时重写（顶部避让读到前留空、读到后补上）。 */
      if (tag.textContent !== css) tag.textContent = css;
      return;
    }
    tag = d.createElement('style');
    tag.setAttribute('data-dshsb', '1');
    tag.textContent = css;
    d.head.appendChild(tag);
  } catch (e) { /* ignore */ }
}


function applyStatusBar() {
  /*
   * 顶部距离只在「进 WebUI 这一次」读：读到之后 TOP_INSET_PX 不再是 null，
   * 后续轮询只负责把 CSS 补进去，不再重新测量（用户明确要求不轮询读取）。
   */
  if (TOP_INSET_PX === null) readTopInset();
  assertViewport();
  injectCss();
}

function onViewportChanged() {
  safe(applyOrder, 'order')();
  safe(applyStatusBar, 'status')();
}
/* ── 启动 ─────────────────────────────────────────────────────────────────── */

function start() {
  if (!state.startedAt) state.startedAt = Date.now();
  if (state.started) return;
  var d = doc();
  if (!d) return;
  state.started = true;

  try {
    d.addEventListener('click', onDocumentClick, false);
    if (typeof window !== 'undefined') {
      /* 旋转 / 软键盘 / 分屏都汇到这里：isPortrait 每次现判，不缓存。 */
      window.addEventListener('resize', safe(onViewportChanged, 'resize'), false);
      window.addEventListener('orientationchange', safe(onViewportChanged, 'rotate'), false);
    }
  } catch (e) { /* ignore */ }

  /*
   * 立即生效一次，之后靠轮询兜底（无 MutationObserver，见文件头说明）。
   */
  /* 逐个包 safe：任何一个内部抛异常都不能中断 start()，否则轮询注册不上。 */
  safe(applyOrder, 'order')();
  safe(applyStatusBar, 'status')();
  try {
    state.timer = setInterval(function () {
      safe(applyOrder, 'order')();
      safe(applyStatusBar, 'status')();
    }, SCAN_INTERVAL_MS);
  } catch (e) { /* ignore */ }
}

var apply = safe(function (ctx) {
  if (!doc()) return;
  var bound = false;
  try {
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () {
        try { start(); } catch (e) { /* ignore */ }
      });
      bound = true;
    }
  } catch (e) { /* ignore */ }
  if (!bound) {
    try { start(); } catch (e) { /* ignore */ }
  }
}, 'apply');

return {
  name: NAME,
  inject: [],
  apply: apply
};
})(require);

var PART_B = (function (require) {
"use strict";

/*
 * dsh-ime-submit-guard - client-side guard for the DSH web composer.
 *
 *   A. Submit guard - the dictation IME auto-sends the message, and truncates it.
 *   B. Focus guard  - the soft keyboard should appear only when the user taps the
 *                     composer; switching chats / pressing send must not raise it.
 *
 * 閳光偓閳光偓 Why the code looks like this 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
 *
 * 1. load() must be called at TOP LEVEL and nothing may throw while this script
 *    runs. The host is a queue loader (window.__ModuleLoader__): if this script
 *    throws, or registers in a way the host does not observe, the queue never
 *    drains, the `dsh web: ...?token=` line is never printed, the folk app never
 *    gets a token and the WebUI never opens - a blank screen. (Observed
 *    2026-10-17; an IIFE-wrapped registration did exactly this.)
 *
 * 2. NO MutationObserver. A callback that writes DOM retriggers its own childList
 *    observation - an endless microtask loop that starves "Loading plugins...".
 *    setInterval polling is safe.
 *
 * 3. apply() must never throw. A degraded guard beats a WebUI that will not open.
 *
 * 閳光偓閳光偓 A. Measured IME behaviour (Xiaomi 2608BPX34C / HyperOS, 2026-10-17) 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
 *
 *   璺?Dictation is a normal composition: many insertCompositionText events, then
 *     ONE compositionend.
 *   璺?compositionend.data ends with U+200B segment markers plus "\n\n" (tail
 *     codes 8203,10,10).
 *   璺?insertCompositionText.data carries the WHOLE dictated text (e.g. 62 chars);
 *     compositionend.data carries only the LAST SEGMENT (e.g. 20 chars).
 *   璺?The host commits using compositionend.data and sends by itself when that
 *     value ends with a newline - one event both truncates and sends.
 *
 *   Fix: in the CAPTURE phase rewrite compositionend.data with the whole captured
 *   text minus trailing markers. Object.defineProperty is what works here; plain
 *   assignment does not. A moment later, if the composer holds only a truncated
 *   tail of the dictation, it is replaced by the full text.
 *
 * 閳光偓閳光偓 B. Focus guard, and why it needs inputmode 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
 *
 *   The keyboard is summoned by the composer receiving focus. Simply calling
 *   blur() inside a focus handler is NOT enough on this device: by the time the
 *   handler runs, the WebView has already told the IME to show (measured: the
 *   keyboard still appeared when switching chats).
 *
 *   So the guard works from the other end. The composer is kept with
 *   inputmode="none", which removes its ability to raise a virtual keyboard at
 *   all, and the attribute is dropped only for a real tap on the composer:
 *
 *       tap composer            -> allow keyboard, focus follows -> keyboard OK
 *       switch chat / send      -> programmatic focus -> no keyboard at all
 *
 *   The tap test uses the touch's START POINT: a tap on the Send button is also a
 *   touch, and the app re-focuses the composer right after it, so marking on any
 *   touch would let that focus through.
 *
 *   blur() is kept as a second line of defence, and the polling loop re-arms the
 *   attribute if React remounts the composer.
 */

var NAME = 'dsh-ime-submit-guard';
var COMPOSER_SELECTOR = '[data-composer-input]';
var LEXICAL_SELECTOR = '[data-lexical-editor]';

var SETTLE_MS = 260;             /* let the browser finish its composition commit */
var GUARD_MS = 2500;             /* window in which a null-payload ENTER is the IME's */
var SCAN_INTERVAL_MS = 900;

var USER_TAP_MS = 900;           /* a focus this soon after a tap on the composer is the user's */
var BLUR_COOLDOWN_MS = 350;      /* debounce so focus/blur cannot oscillate */

/*
 * 正式版本：关闭调试角标。
 *
 * 调试期间需要它，是因为本设备上 WebView 的 console.log 不会转发到 logcat
 * （adb logcat | grep 拿不到），页面上可见的角标是当时唯一能观测守卫行为的载体。
 * 功能已验证完毕，这里置回 false；如需再排查，改 true 即可恢复。
 */
var DEBUG_BADGE = false;

var state = {
  started: false,
  timer: null,
  composeUntil: 0,
  fullText: '',
  handled: false,
  lastComposerTap: 0,
  blurUntil: 0,
  armed: false,
  stats: { suppressed: 0, allowed: 0 },
  badgeEl: null,
  badgeText: ''
};

function doc() {
  try {
    return typeof document !== 'undefined' ? document : null;
  } catch (e) {
    return null;
  }
}

/*
 * 正式版本不再输出调试日志。
 *
 * 有意保留这个空函数（而不是删掉所有调用点）：正式版与调试版的差异因此只剩
 * DEBUG_BADGE 与这里两处，最大限度降低改动已验证产物的风险。
 */
function log() {
  /* 有意为空 */
}

/* Wrap so a callback can never throw outwards. */
function safe(fn, label) {
  return function () {
    try {
      return fn.apply(this, arguments);
    } catch (error) {
      try { console.warn('[' + NAME + '] ' + label + ': ' + error); } catch (e) { /* ignore */ }
      return undefined;
    }
  };
}

function findComposer() {
  var d = doc();
  if (!d) return null;
  try {
    return d.querySelector(COMPOSER_SELECTOR) || d.querySelector(LEXICAL_SELECTOR);
  } catch (e) {
    return null;
  }
}

function isInComposer(node) {
  var el = findComposer();
  if (!el || !node) return false;
  try {
    return node === el || el.contains(node);
  } catch (e) {
    return false;
  }
}

function textOf(el) {
  try {
    return el && typeof el.textContent === 'string' ? el.textContent : '';
  } catch (e) {
    return '';
  }
}

/* 閳光偓閳光偓 A. submit / truncation guard 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

/* Drop trailing newlines and trailing zero-width segment markers. */
function trimTail(data) {
  return typeof data === 'string'
    ? data.replace(/[\u200b\u200c\u200d\ufeff\r\n\s]+$/, '')
    : '';
}

/* Strip markers the IME leaves BETWEEN segments, plus the trailing newline. */
function normalise(data) {
  return typeof data === 'string'
    ? data.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/[\r\n\s]+$/, '')
    : '';
}

/* Overwrite event.data - defineProperty is the form that works on this host. */
function setEventData(event, value) {
  try {
    event.data = value;
    if (event.data === value) return true;
  } catch (e) { /* ignore */ }
  try {
    Object.defineProperty(event, 'data', {
      value: value, configurable: true, enumerable: true, writable: true
    });
    return event.data === value;
  } catch (e) {
    return false;
  }
}

/* Paste plain text into the composer (the only channel that really writes here). */
function pasteText(el, text) {
  try {
    var dt = null;
    try {
      dt = new DataTransfer();
      dt.setData('text/plain', text);
    } catch (e) { dt = null; }
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt
    }));
    return true;
  } catch (e) {
    return false;
  }
}

/* Delete characters via synthetic Backspace keys (core Lexical key handling). */
function deleteBackwards(el, count) {
  var n = Math.min(count, 400);
  for (var i = 0; i < n; i++) {
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8,
        bubbles: true, cancelable: true
      }));
      el.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true
      }));
    } catch (e) {
      return;
    }
  }
}

/*
 * Repair a truncated dictation - only when what is on screen is recognisably the
 * tail of the full text, so ordinary typing is never touched.
 */
function repairIfTruncated() {
  if (state.handled) return;
  state.handled = true;

  var want = normalise(state.fullText);
  state.fullText = '';
  if (!want) return;

  var el = findComposer();
  if (!el) return;
  var cur = textOf(el);

  if (cur === want) return;                       /* already complete */
  if (!cur) return;                               /* composer was emptied */
  if (cur.length >= want.length) return;          /* nothing lost */
  if (cur.length > want.length) return;           /* safety: never grow it */

  var probe = cur.length > 8 ? cur.slice(-8) : cur;
  if (want.indexOf(probe) === -1) return;

  deleteBackwards(el, cur.length + 2);

  setTimeout(safe(function () {
    if (textOf(el).length !== 0) return;          /* clearing failed - leave it alone */
    pasteText(el, want);

    setTimeout(safe(function () {
      if (textOf(el) !== want) {
        deleteBackwards(el, textOf(el).length + 2);
        setTimeout(safe(function () {
          pasteText(el, want);
        }, 'retry'), SETTLE_MS);
      }
    }, 'verify'), SETTLE_MS);
  }, 'clear'), SETTLE_MS);
}

/* Capture phase: rewrite the trailing newline away so the host does not send. */
function onCompositionEnd(event) {
  try {
    var own = event && typeof event.data === 'string' ? event.data : '';
    var full = state.fullText && state.fullText.length >= own.length ? state.fullText : own;
    var replacement = trimTail(full);
    if (replacement !== own) setEventData(event, replacement);
    state.composeUntil = Date.now() + GUARD_MS;
    setTimeout(safe(repairIfTruncated, 'repair'), SETTLE_MS);
  } catch (e) { /* ignore */ }
}

/* insertCompositionText.data is the live full text - remember it. */
function onBeforeInput(event) {
  try {
    if (!event || typeof event.data !== 'string' || !event.data.length) return;
    var t = typeof event.inputType === 'string' ? event.inputType : '';
    if (t === 'insertCompositionText' || t === 'insertText') {
      state.fullText = event.data;
      state.handled = false;
    }
  } catch (e) { /* ignore */ }
}

/* 閳光偓閳光偓 B. focus guard 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

/*
 * inputmode must sit on the element that is actually editable - [data-composer-input]
 * may only be an outer wrapper around it. Collect every plausible target.
 */
function keyboardTargets() {
  var d = doc();
  var out = [];
  if (!d) return out;
  try {
    var el = d.querySelector(COMPOSER_SELECTOR);
    if (el) {
      out.push(el);
      var inner = el.querySelector('[contenteditable="true"]');
      if (inner) out.push(inner);
    }
    var lex = d.querySelector(LEXICAL_SELECTOR);
    if (lex) {
      out.push(lex);
      var innerLex = lex.querySelector('[contenteditable="true"]');
      if (innerLex) out.push(innerLex);
    }
  } catch (e) { /* ignore */ }
  return out;
}

/* Remove the composer's ability to raise a virtual keyboard. */
function blockKeyboard() {
  var targets = keyboardTargets();
  if (!targets.length) return false;
  for (var i = 0; i < targets.length; i++) {
    try {
      if (targets[i].getAttribute('inputmode') !== 'none') {
        targets[i].setAttribute('inputmode', 'none');
      }
    } catch (e) { /* ignore */ }
  }
  state.armed = true;
  return true;
}

/* Restore normal keyboard behaviour for a real tap on the composer. */
function allowKeyboard() {
  var targets = keyboardTargets();
  for (var i = 0; i < targets.length; i++) {
    try {
      if (targets[i].hasAttribute('inputmode')) targets[i].removeAttribute('inputmode');
    } catch (e) { /* ignore */ }
  }
  state.armed = false;
}

function onPointerDown(event) {
  try {
    if (isInComposer(event && event.target)) {
      state.lastComposerTap = Date.now();
      allowKeyboard();
    }
  } catch (e) { /* ignore */ }
}

function onFocusIn(event) {
  try {
    var node = event && event.target;
    if (!isInComposer(node)) return;

    var composer = findComposer();

    if (Date.now() - state.lastComposerTap < USER_TAP_MS) {
      state.stats.allowed++;
      allowKeyboard();
      drawBadge();
      return;                                   /* the user tapped it - keyboard is fine */
    }

    /* Programmatic focus: block the keyboard AND drop focus as a fallback. */
    state.stats.suppressed++;
    blockKeyboard();

    if (Date.now() >= state.blurUntil) {
      state.blurUntil = Date.now() + BLUR_COOLDOWN_MS;
      try { if (node.blur) node.blur(); } catch (e) { /* ignore */ }
    }
    drawBadge();
  } catch (e) { /* ignore */ }
}

function onFocusOut() {
  /* Once focus leaves the composer, re-arm the block. */
  setTimeout(safe(function () {
    var d = doc();
    if (d && !isInComposer(d.activeElement)) blockKeyboard();
  }, 'focusout'), 60);
}

/* ── 需求：点击发送后自动收起输入法 ───────────────────────────────────────── */

/*
 * 主发送按钮：ui-conversation 的 InputBar 里那个
 *   <button class="…_primary" aria-label="发送消息 / Send message">
 * 它故意带 onMouseDown={keepFocus}，所以点它时 composer 不失焦、键盘不收起 ——
 * 本函数就是在发送动作完成后补上「收键盘」这一步。
 *
 * 用 class 后缀匹配（类名带构建哈希），再核对 aria-label 是否含「发送/Send」，
 * 避免把同一位置的「停止」按钮也当成发送。
 */
function isSendButton(node) {
  try {
    if (!node || typeof node.closest !== 'function') return false;
    /*
     * 两条线索，任意命中即可：
     *   1) class 含 "_primary"（InputBar 的主按钮，类名带 CSS modules 哈希）；
     *   2) aria-label 含「发送 / Send」（发送消息、排队发送、插话发送都算）；
     *      「停止 / Stop」不含发送字样，不会被误判。
     */
    var btn = node.closest('button[class*="_primary"]') ||
      node.closest('button[aria-label*="发送"]') ||
      node.closest('button[aria-label*="Send"]');
    if (!btn) return false;
    var label = btn.getAttribute('aria-label') || '';
    return label.indexOf('发送') !== -1 || label.toLowerCase().indexOf('send') !== -1;
  } catch (e) {
    return false;
  }
}

function hideComposerKeyboard() {
  var d = doc();
  var composer = findComposer();
  /* 先重新武装屏蔽，避免 app 发送后程序性 focus 又把键盘拉起来。 */
  blockKeyboard();
  try {
    var active = d && d.activeElement;
    if (active && typeof active.blur === 'function' &&
        (composer === active || (composer && composer.contains && composer.contains(active)))) {
      active.blur();
    } else if (composer && typeof composer.blur === 'function') {
      composer.blur();
    } else if (active && typeof active.blur === 'function') {
      active.blur();
    }
  } catch (e) { /* ignore */ }
}

function onSendClick(event) {
  try {
    var target = event && event.target;
    if (!isSendButton(target)) return;
    /*
     * 清掉「用户刚点过输入框」的时间戳：发送后 app 往往会程序性 focus 回 composer，
     * 若还在 USER_TAP_MS 窗口内，onFocusIn 会把它当作用户点击放行、键盘又弹回来。
     */
    state.lastComposerTap = 0;
    setTimeout(safe(function () {
      hideComposerKeyboard();
    }, 'send-hide'), 80);
  } catch (e) { /* ignore */ }
}

/* 閳光偓閳光偓 status badge (verification only) 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

function drawBadge() {
  if (!DEBUG_BADGE) return;
  try {
    var text = 'S' + state.stats.suppressed + ' A' + state.stats.allowed +
      (state.armed ? ' armed' : ' open');
    if (text === state.badgeText && state.badgeEl && state.badgeEl.isConnected) return;
    var d = doc();
    if (!d) return;
    var host = d.documentElement || d.body;
    if (!host) return;
    if (!state.badgeEl || !state.badgeEl.isConnected) {
      var el = d.createElement('div');
      el.setAttribute('style',
        'position:fixed;right:3px;bottom:3px;z-index:2147483647;background:#013;color:#7f7;' +
        'font:9px/1.2 monospace;padding:2px 4px;border-radius:4px;opacity:.9;pointer-events:none');
      host.appendChild(el);
      state.badgeEl = el;
    }
    state.badgeEl.textContent = text;
    state.badgeText = text;
  } catch (e) { /* ignore */ }
}

function start() {
  if (state.started) return;
  var d = doc();
  if (!d) return;
  state.started = true;

  try {
    d.addEventListener('compositionend', onCompositionEnd, true);
    d.addEventListener('beforeinput', onBeforeInput, true);
    d.addEventListener('pointerdown', onPointerDown, true);
    d.addEventListener('touchstart', onPointerDown, true);
    d.addEventListener('mousedown', onPointerDown, true);
    d.addEventListener('focusin', onFocusIn, true);
    d.addEventListener('focusout', onFocusOut, true);
    /* 捕获阶段先记一笔：发送按钮点击时不与 PART_A 的点击处理抢顺序。 */
    d.addEventListener('click', onSendClick, true);
  } catch (e) { /* ignore */ }

  /* Arm the block immediately, then keep it armed across React remounts. */
  blockKeyboard();
  drawBadge();

  /*
   * Polling only - no MutationObserver (see the header note). Besides re-arming
   * the keyboard block, it clears the per-composition flag.
   */
  try {
    state.timer = setInterval(safe(function () {
      if (Date.now() > state.composeUntil) state.handled = false;
      var el = findComposer();
      if (el) {
        var d2 = doc();
        var active = d2 && d2.activeElement;
        if (!state.armed && !isInComposer(active)) blockKeyboard();
        else if (state.armed && Date.now() - state.lastComposerTap < USER_TAP_MS) allowKeyboard();
      }
      drawBadge();
    }, 'timer'), SCAN_INTERVAL_MS);
  } catch (e) { /* ignore */ }

  log('started');
}

var apply = safe(function (ctx) {
  if (!doc()) return;
  var bound = false;
  try {
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () {
        try { start(); } catch (e) { /* ignore */ }
      });
      bound = true;
    }
  } catch (e) { /* ignore */ }
  if (!bound) {
    try { start(); } catch (e) { /* ignore */ }
  }
}, 'apply');

return {
  name: NAME,
  inject: [],
  apply: apply
};
})(require);

return {
  name: 'dsh-mobile-tweaks',
  inject: [],
  apply: function (ctx) {
    try { PART_A.apply(ctx); } catch (e) {}
    try { PART_B.apply(ctx); } catch (e) {}
  }
};
} });
