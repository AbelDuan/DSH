/**
 * dsh-mobile-tweaks，node（宿主）侧。
 *
 * 纯客户端插件：真正干活的代码在浏览器里（lib/client.js）。
 * 本文件只让 profile Loader 里有一个可解析的插件行 ——
 * cordis.patch.yml 里 insert 的 name 指向本包，host 端需要一个 apply。
 * 这里刻意什么都不做：不加路由、不碰 http、不改宿主服务。
 */

/** 插件名（与 package.json / cordis.patch.yml 的 id 一致）。 */
export const name = 'dsh-mobile-tweaks';

/** 宿主侧空实现。 */
export function apply(_ctx) {
    // 有意为空。
}
