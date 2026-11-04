# dsh-mobile-tweaks

DSH-Folk 手机端 Web UI 合并插件（本地）。三块互相独立的功能，全部在浏览器侧执行：

| 模块 | 作用 |
|---|---|
| 状态栏避让 | 修正 `#root` 顶部留白：进页面时读一次系统真实顶部距离 |
| 侧边栏排序 | 小鲸鱼置底、竖屏点会话后自动收起 |
| 输入法守卫 | 发送后自动收起输入法、提交与焦点保护 |

宿主侧 `lib/index.js` 是空实现，只为让 profile Loader 能解析到这一行插件。

## 状态栏避让（2026-11-05 修复）

### 问题

App 外壳 `__dsh_folk_insets__` 会往 `#root` 注入 `padding-top`。原先插件用写死的
`max(65px, env(safe-area-inset-top))` 去覆盖，与系统实际下发的值对不上：

- 状态栏尺寸模块 `com.abel.statussize` 的 `dsh_app_top_dp` 决定系统下发的 top inset；
- 外壳又按自己的 insets 再写一次 padding；
- 两者叠加后实测顶部空白 **142px**，而系统真实值只有 **45px**。

### 修复

不再写死常量。**进入 WebUI 时读一次**系统真实顶部距离，之后不再重读：

```js
chrome = window.innerHeight - document.documentElement.clientHeight
```

`viewport-fit=cover` 下这个差值就是浏览器为「被顶部遮挡区域」预留的高度。
差值 ≤ 0 时才退回 `env(safe-area-inset-top)`。

生成规则：

```css
html body #root { padding-top: <读到的值>px !important }
```

`html body` 前缀把特异性抬到 (1,0,2)，压过外壳的 (1,0,0)。

### 实测

| | 修复前 | 修复后 |
|---|---|---|
| `#root` 内容顶部 | 142px | 44px |
| 系统下发值 | 45px | 45px |

## 安装（本机）

真身：`~/.dsh/plugins/dsh-mobile-tweaks/`
三条入口软链（缺一条就静默失效）：

```
/usr/local/lib/node_modules/dsh-mobile-tweaks -> 真身
/root/.node_modules/dsh-mobile-tweaks          -> 真身
/root/.dsh/node_modules/dsh-mobile-tweaks      -> 真身
```

自愈脚本：`sh ~/.dsh/plugins/fix-mobile-tweaks.sh`
改完代码重启 DSH App 生效。
