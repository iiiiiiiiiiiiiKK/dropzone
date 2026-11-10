import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'zh';

/** Every user-facing string lives here as [english, 简体中文]. */
const DICT: Record<string, [string, string]> = {
  'brand.tagline': ['Transfer space', '传输空间'],
  'top.author': ['Author on X — @0xkillcoin', '作者 X — @0xkillcoin'],

  // navigation
  'nav.workspace': ['Workspace', '工作台'],
  'nav.history': ['Recent transfers', '最近传输'],
  'nav.favorites': ['Favorites', '收藏'],
  'nav.devices': ['My devices', '我的设备'],
  'nav.settings': ['Settings', '设置'],
  'nav.mobileSend': ['Send', '传输'],
  'nav.mobileHistory': ['History', '历史'],
  'nav.mobileSaved': ['Saved', '收藏'],
  'nav.mobileDevices': ['Devices', '设备'],
  'nav.mobileSettings': ['Settings', '设置'],

  // top bar / status
  'top.lang': ['Switch language', '切换语言'],
  'top.themeLight': ['Switch to light theme', '切换到浅色主题'],
  'top.themeDark': ['Switch to dark theme', '切换到深色主题'],
  'top.device': ['This device', '本机'],
  'top.online': ['{n} online', '{n} 台在线'],
  'top.relay': ['Relay', '中继'],
  'top.reconnect': ['Reconnect relay', '重连中继'],
  'status.online': ['Signaling connected', '信令已连接'],
  'status.connecting': ['Connecting…', '正在连接…'],
  'status.reconnecting': ['Reconnecting…', '正在重连…'],
  'status.offline': ['Offline', '离线'],
  'status.idle': ['Idle', '空闲'],
  'status.error': ['Unreachable', '无法连接'],
  'status.localFirst': ['Local-first by design', '本地优先设计'],
  'status.devicesOnline': ['{online} of {total} devices online', '{total} 台设备中 {online} 台在线'],
  'status.relayed': [' · {n} relayed', ' · {n} 条走中继'],

  // drop zone
  'drop.title': ['Drop anything here', '把内容拖到这里'],
  'drop.titleDragging': ['Release to stage your files', '松手即可加入待发送'],
  'drop.subtitle': [
    'Screenshots, files, folders — nothing leaves your devices. Files travel peer-to-peer over an encrypted data channel.',
    '截图、文件、文件夹都可以，内容不经过任何服务器。文件通过加密数据通道点对点传输。',
  ],
  'drop.choose': ['Choose files', '选择文件'],
  'drop.paste': ['Paste screenshot', '粘贴截图'],
  'drop.onWindows': ['on Windows', 'Windows'],
  'drop.onMac': ['on macOS', 'macOS'],
  'drop.multi': ['multi-select allowed', '支持多选'],
  'drop.noDevices': ['No paired devices yet — pair one before sending.', '还没有配对设备，先配对再发送。'],

  // queue
  'queue.staged': ['{n} staged', '{n} 个待发送'],
  'queue.total': ['{size} total', '共 {size}'],
  'queue.clear': ['Clear', '清空'],
  'queue.sendTo': ['Send to', '发送到'],
  'queue.noDevices': ['No devices', '暂无设备'],
  'queue.online': ['online', '在线'],
  'queue.offline': ['offline', '离线'],
  'queue.sendNow': ['Send now', '立即发送'],
  'queue.sendItems': ['Send {n} items', '发送 {n} 项'],
  'queue.liveLink': ['Live link', '已连接'],
  'queue.remove': ['Remove {name}', '移除 {name}'],

  // device rail
  'rail.title': ['My devices', '我的设备'],
  'rail.summary': ['{paired} paired · {online} online', '已配对 {paired} 台 · {online} 台在线'],
  'rail.pair': ['Pair', '配对'],
  'rail.emptyTitle': ['No devices paired', '还没有配对设备'],
  'rail.emptyDesc': [
    'Open DROPZONE on your phone and scan its QR code to create an encrypted pairing.',
    '在手机上打开 DROPZONE，扫描二维码即可建立加密配对。',
  ],
  'rail.pairCta': ['Pair a device', '配对设备'],
  'rail.online': ['Online', '在线'],
  'rail.lastSeen': ['Last seen {time}', '最后活跃 {time}'],
  'rail.linkRelay': ['TURN relay', 'TURN 中继'],
  'rail.linkDirect': ['P2P direct', 'P2P 直连'],
  'rail.linkPending': ['linking', '正在建立连接'],
  'rail.send': ['Send', '发送'],
  'rail.unpair': ['Unpair device', '解除配对'],
  'rail.safety': ['safety {code}', '安全码 {code}'],
  'rail.blurbTitle': ['Peer-to-peer by default', '默认点对点'],
  'rail.blurb': [
    'Files move directly between devices. When NAT blocks a direct path, traffic falls back to your own TURN relay — never to a storage bucket.',
    '文件直接在设备之间传输。当 NAT 阻断直连时，流量回退到你自己的 TURN 中继，绝不会落到存储桶。',
  ],
  'rail.unpairTitle': ['Unpair {name}?', '解除与 {name} 的配对？'],
  'rail.unpairDesc': [
    'This removes the trust link and history association on this device only. The other device keeps its own copy.',
    '仅在本机移除信任关系与历史关联，对方设备仍保留自己的数据。',
  ],
  'rail.keep': ['Keep device', '保留设备'],
  'rail.unpairCta': ['Unpair', '解除配对'],
  'rail.unpairBody': ['You can pair again at any time with a fresh QR code. Safety number:', '随时可以用新的二维码重新配对。安全码：'],

  // text composer
  'text.title': ['Send text', '发送文字'],
  'text.hint': ['links, code, anything', '链接、代码、任意文本'],
  'text.placeholder': ['Paste a link, a snippet, or a note…', '粘贴链接、代码片段或备忘…'],
  'text.paste': ['Paste', '粘贴'],
  'text.send': ['Send', '发送'],
  'text.live': ['Live link ready — text is delivered instantly.', '连接已就绪，文字即时送达。'],
  'text.empty': ['Nothing received yet.', '还没有收到内容。'],
  'text.from': ['from {name}', '来自 {name}'],
  'text.to': ['to {name}', '发送给 {name}'],
  'text.copy': ['Copy text', '复制文字'],

  // transfer row
  'xfer.sending': ['sending', '发送中'],
  'xfer.receiving': ['receiving', '接收中'],
  'xfer.queued': ['queued', '排队中'],
  'xfer.connecting': ['connecting', '连接中'],
  'xfer.verifying': ['verifying', '校验中'],
  'xfer.completed': ['completed', '已完成'],
  'xfer.failed': ['failed', '失败'],
  'xfer.canceled': ['canceled', '已取消'],
  'xfer.interrupted': ['interrupted', '已中断'],
  'xfer.rejected': ['rejected', '被拒绝'],
  'xfer.eta': ['ETA {time}', '剩余 {time}'],
  'xfer.from': ['from {name}', '来自 {name}'],
  'xfer.to': ['to {name}', '发送给 {name}'],
  'xfer.save': ['Save file', '保存文件'],
  'xfer.favorite': ['Add to favorites', '加入收藏'],
  'xfer.unfavorite': ['Remove from favorites', '取消收藏'],
  'xfer.cancel': ['Cancel transfer', '取消传输'],
  'xfer.retry': ['Retry', '重试'],
  'xfer.delete': ['Delete record', '删除记录'],

  // pairing dialog
  'pair.title': ['Pair a device', '配对设备'],
  'pair.desc': [
    'Create an encrypted trust link with a one-time code. Nothing is stored in the cloud.',
    '用一次性凭证建立加密信任关系，全部数据只保存在本机。',
  ],
  'pair.tabQr': ['My QR', '我的二维码'],
  'pair.tabScan': ['Scan', '扫码'],
  'pair.tabLink': ['Link', '链接'],
  'pair.generating': ['Generating…', '生成中…'],
  'pair.expiresIn': ['expires in {time}', '{time} 后过期'],
  'pair.expired': ['expired', '已过期'],
  'pair.newCode': ['New code', '刷新凭证'],
  'pair.instructions': [
    'Open DROPZONE on the other device → Pair → Scan. The code is single-use and dies when it expires.',
    '在另一台设备打开 DROPZONE → 配对 → 扫码。凭证一次性使用，到期即失效。',
  ],
  'pair.copyLink': ['Copy pairing link', '复制配对链接'],
  'pair.scanHint': [
    "Point the camera at the other device's QR code. Camera access is requested only while this tab is open.",
    '把镜头对准另一台设备的二维码。仅在当前面板打开时申请摄像头权限。',
  ],
  'pair.startCamera': ['Start camera', '开启摄像头'],
  'pair.stopCamera': ['Stop camera', '关闭摄像头'],
  'pair.cameraFailed': ['Camera unavailable: {msg}', '无法使用摄像头：{msg}'],
  'pair.notDropzone': ['That code is not a DROPZONE pairing link.', '这不是 DROPZONE 的配对链接。'],
  'pair.codeExpired': ['This pairing code has expired. Ask the other device for a fresh one.', '该配对码已过期，请在另一台设备刷新后重试。'],
  'pair.linkLabel': ['Paste a pairing link or token', '粘贴配对链接或凭证'],
  'pair.linkPlaceholder': ['dropzone://pair?d=… or https://…/#/pair?d=…', 'dropzone://pair?d=… 或 https://…/#/pair?d=…'],
  'pair.linkCta': ['Pair with this code', '使用该凭证配对'],
  'pair.summaryNone': ['No devices paired yet. ', '还没有配对设备。'],
  'pair.summarySome': ['Paired: {list}. ', '已配对：{list}。'],
  'pair.onlineNow': ['Online now: {n}.', '当前在线：{n} 台。'],
  'pair.keyNote': [
    'Every device keeps its own identity key — the QR only carries a short-lived invitation.',
    '每台设备各自持有身份密钥，二维码里只有短期邀请凭证。',
  ],

  // workspace
  'ws.quickPaste': ['Paste', '粘贴'],
  'ws.quickPhotos': ['Photos', '相册'],
  'ws.quickFiles': ['Files', '文件'],
  'ws.quickText': ['Text', '文字'],
  'ws.recent': ['Recent transfers', '最近传输'],
  'ws.viewAll': ['View all', '查看全部'],
  'ws.emptyPairTitle': ['Pair your first device', '先配对你的第一台设备'],
  'ws.emptyNothingTitle': ['Nothing transferred yet', '还没有传输记录'],
  'ws.emptyPairDesc': [
    'Pair a phone or a second computer to start moving screenshots and files without a chat app.',
    '配对一台手机或第二台电脑，就能不经过聊天软件直接传截图和文件。',
  ],
  'ws.emptyNothingDesc': [
    'Paste a screenshot or drop a file — your transfers will appear here, stored only on this device.',
    '粘贴截图或拖入文件，传输记录会出现在这里，只保存在本机。',
  ],
  'ws.tip': [
    'Tip: everything here lives in this browser. Clearing site data removes your history — favorites included.',
    '提示：所有数据都在这个浏览器里，清除站点数据会连收藏一起消失。',
  ],

  // history
  'hist.search': ['Search by file name or device', '按文件名或设备搜索'],
  'hist.all': ['All', '全部'],
  'hist.files': ['Files', '文件'],
  'hist.text': ['Text', '文字'],
  'hist.favorites': ['Favorites', '收藏'],
  'hist.clear': ['Clear', '清空'],
  'hist.emptyFavTitle': ['No favorites yet', '还没有收藏'],
  'hist.emptyTitle': ['No transfers yet', '还没有传输记录'],
  'hist.emptyFavDesc': ['Star a transfer to keep it pinned regardless of the retention limit.', '给传输记录加星标，可不受保留条数限制。'],
  'hist.emptyDesc': [
    'Paste a screenshot, drop a file, or send text — everything shows up here and stays on this device.',
    '粘贴截图、拖入文件或发送文字，记录都会出现在这里，且只留在本机。',
  ],
  'hist.localNote': ['History is local-only. It never syncs to other devices and is not uploaded anywhere.', '历史记录只存在本地，不会同步到其他设备，也不会上传。'],
  'hist.clearTitle': ['Clear all local history?', '清空本地历史？'],
  'hist.clearDesc': [
    'Transfers, cached files and received text will be deleted from this browser. This cannot be undone.',
    '传输记录、缓存文件与接收到的文字都会从本浏览器删除，且无法恢复。',
  ],
  'hist.records': ['{n} records', '{n} 条记录'],
  'hist.clearBodyExtra': ['cached files and thumbnails included', '包含缓存文件与缩略图'],
  'hist.deleteEverything': ['Delete everything', '全部删除'],

  // devices view
  'dev.thisDevice': ['This device', '本机'],
  'dev.id': ['ID {id}…', 'ID {id}…'],
  'dev.initialising': ['initialising identity…', '正在初始化身份…'],
  'dev.pairDevice': ['Pair a device', '配对设备'],
  'dev.deviceName': ['Device name', '设备名称'],
  'dev.identityKey': ['Identity key', '身份公钥'],
  'dev.pairedDevices': ['Paired devices', '已配对设备'],
  'dev.trusted': ['{n} trusted', '{n} 台受信任'],
  'dev.emptyTitle': ['No trusted devices yet', '还没有受信任设备'],
  'dev.emptyDesc': [
    'Pairing creates a one-time code that links two devices. After that, no login is ever required.',
    '配对会生成一次性凭证把两台设备绑定，之后无需任何登录。',
  ],
  'dev.pairNow': ['Pair now', '立即配对'],
  'dev.link': ['Link', '连接'],
  'dev.safetyNumber': ['Safety number', '安全码'],
  'dev.sendFiles': ['Send files', '发送文件'],
  'dev.unpair': ['Unpair', '解除配对'],
  'dev.verified': ['verified', '已验证'],
  'dev.trustTitle': ['How trust works here', '这里的信任机制'],
  'dev.trust1': [
    'Each device generates an ECDSA P-256 key pair; the private key never leaves this browser and cannot be exported.',
    '每台设备生成 ECDSA P-256 密钥对，私钥永不离开浏览器，也无法导出。',
  ],
  'dev.trust2': ['A pairing code is a single-use secret that expires in five minutes. It is not a long-term key.', '配对码是五分钟有效的一次性凭证，并非长期密钥。'],
  'dev.trust3': [
    'Both devices derive the same safety number from their public keys — compare it out loud to rule out a relay swap.',
    '两台设备由公钥推导出同一个安全码，可口头核对，以排除中继替换。',
  ],
  'dev.trust4': [
    'Files are encrypted in transit by DTLS-SRTP on the WebRTC data channel. The relay only brokers connection metadata.',
    '文件在 WebRTC 数据通道上由 DTLS-SRTP 加密，中继只负责连接元数据。',
  ],
  'dev.secure': ['secure context', '安全上下文'],
  'dev.insecure': ['insecure context — WebRTC still works locally', '非安全上下文，仅本地 WebRTC 可用'],
  'dev.relayPeers': ['{n} relay peer', '{n} 个中继邻居'],
  'dev.relayPeersPlural': ['{n} relay peers', '{n} 个中继邻居'],
  'dev.unpairTitle': ['Unpair this device?', '解除该设备配对？'],
  'dev.unpairDesc': ['The trust link is removed locally. You can pair again with a fresh QR code.', '信任关系仅在本机移除，之后可用新二维码重新配对。'],
  'dev.keep': ['Keep', '保留'],
  'dev.unpairBody': ['Transfers already stored stay in your local history.', '已经保存的传输记录仍留在本地历史中。'],

  // settings
  'set.appearance': ['Appearance', '外观'],
  'set.appearanceHint': ['Dark is the default. Your choice is stored locally.', '默认深色，选择只保存在本机。'],
  'set.dark': ['Dark', '深色'],
  'set.light': ['Light', '浅色'],
  'set.language': ['Language', '语言'],
  'set.languageHint': ['Switch the whole interface without reloading.', '切换整个界面语言，无需刷新。'],
  'set.displayLanguage': ['Display language', '界面语言'],
  'set.behaviour': ['Transfer behaviour', '传输行为'],
  'set.behaviourHint': ['How incoming content is handled on this device.', '本机如何处理收到的内容。'],
  'set.autoReceive': ['Auto-receive files', '自动接收文件'],
  'set.autoReceiveDesc': [
    'Accept transfers from paired devices without a prompt. Turn off to approve every incoming file.',
    '来自已配对设备的文件直接接收；关闭后每次都需要你确认。',
  ],
  'set.notifications': ['Desktop notifications', '桌面通知'],
  'set.notificationsDesc': ['Show a system notification when a transfer completes in the background.', '后台传输完成时弹出系统通知。'],
  'set.allow': ['Allow', '授权'],
  'set.retention': ['History retention', '历史保留条数'],
  'set.retentionDesc': ['Favorites are always kept. Older records beyond this limit are pruned automatically.', '收藏始终保留，超出条数的旧记录会被自动清理。'],
  'set.records': ['{n} records', '{n} 条'],
  'set.relay': ['Signaling relay', '信令中继'],
  'set.relayHint': ['The relay only brokers connection metadata; file bytes never touch it.', '中继只负责连接元数据，文件字节不经过它。'],
  'set.reconnect': ['Reconnect', '重连'],
  'set.turnAvailable': ['TURN relay available', '已配置 TURN 中继'],
  'set.stunOnly': ['STUN only', '仅 STUN'],
  'set.pairedCount': ['{n} paired', '已配对 {n} 台'],
  'set.endpoint': ['Relay endpoint override', '中继地址覆盖'],
  'set.endpointHint': ['Empty = use the endpoint baked into this deployment.', '留空表示使用本次部署内置的地址。'],
  'set.apply': ['Apply', '应用'],
  'set.storage': ['Local storage', '本地存储'],
  'set.storageHint': ['Everything DROPZONE keeps lives in this browser profile.', 'DROPZONE 保存的所有内容都在这个浏览器里。'],
  'set.used': ['{size} used', '已用 {size}'],
  'set.ofQuota': ['of {size} available', '可用 {size}'],
  'set.quotaUnknown': ['quota unknown', '配额未知'],
  'set.persist': ['Storage is persistent', '存储已是持久化'],
  'set.requestPersist': ['Request persistence', '申请持久化存储'],
  'set.export': ['Export data', '导出数据'],
  'set.clearHistory': ['Clear history', '清空历史'],
  'set.exportNote': ['Export contains device records, transfer metadata and received text — never private keys.', '导出内容包含设备记录、传输元数据与接收到的文字，绝不含私钥。'],
  'set.about': ['About', '关于'],
  'set.aboutHint': ['DROPZONE — Your Personal Transfer Space.', 'DROPZONE —— 你的个人传输空间。'],
  'set.version': ['Version', '版本'],
  'set.license': ['License', '许可证'],
  'set.source': ['Source', '源码'],
  'set.author': ['Author', '作者'],
  'set.privacyNote': [
    'No accounts, no analytics, no cloud storage. The signaling relay sees device IDs, display names and SDP/ICE metadata — never file names, file contents or clipboard text.',
    '没有账号、没有统计、没有云端存储。中继只能看到设备 ID、显示名与 SDP/ICE 元数据，看不到文件名、文件内容或剪贴板文字。',
  ],
  'set.clearTitle': ['Delete local history?', '删除本地历史？'],
  'set.clearDesc': [
    'Transfers, cached file blobs and received text will be removed from this browser. This cannot be undone.',
    '传输记录、缓存的文件与接收文字都会从本浏览器移除，无法恢复。',
  ],
  'set.clearBody': ['{n} transfer records and {m} device links will stay, only the transfer data is removed.', '保留 {m} 条设备关系，删除 {n} 条传输数据。'],
  'set.delete': ['Delete everything', '全部删除'],

  // toasts and transfer notices
  'toast.stagedOne': ['1 image staged', '已加入 1 张图片'],
  'toast.stagedMany': ['{n} images staged', '已加入 {n} 张图片'],
  'toast.stagedBodyDevices': ['Pick a device and hit send.', '选择设备后点击发送。'],
  'toast.stagedBodyNoDevice': ['Pair a device to send it.', '先配对设备才能发送。'],
  'toast.noDeviceTitle': ['No device selected', '未选择设备'],
  'toast.noDeviceBody': ['Pair a device first — scan its QR code from Devices.', '请先配对设备：在「我的设备」里扫描二维码。'],
  'toast.relayOfflineTitle': ['Relay offline', '中继离线'],
  'toast.relayOfflineBody': ['Reconnect the signaling relay before sending.', '发送前请先重连信令中继。'],
  'toast.textSent': ['Text sent', '文字已发送'],
  'toast.textFailed': ['Text not sent', '文字发送失败'],
  'toast.pairedTitle': ['Paired with {name}', '已与 {name} 配对'],
  'toast.pairedBody': ['Confirm the safety number on both devices.', '请在两台设备上核对安全码。'],
  'toast.pairProblem': ['Pairing problem', '配对失败'],
  'toast.unpaired': ['Device unpaired', '已解除配对'],
  'toast.unpairedBody': ['The pairing link was removed on this device.', '已在本机移除该配对关系。'],
  'toast.canceled': ['Transfer canceled', '传输已取消'],
  'toast.cleared': ['Local history cleared', '本地历史已清空'],
  'toast.pairing': ['Pairing with {name}', '正在与 {name} 配对'],
  'toast.pairingBody': ['Hold both devices until the pairing completes.', '请保持两台设备在线，等待配对完成。'],
  'toast.notify': ['Notifications', '通知'],
  'toast.notifyDenied': ['The browser did not grant notification permission.', '浏览器未授予通知权限。'],
  'toast.storageDenied': ['The browser did not grant persistent storage. Data may be evicted under pressure.', '浏览器未授予持久化存储，空间紧张时数据可能被清理。'],
  'notice.incoming': ['Incoming from {name}', '{name} 正在发送'],
  'notice.complete': ['Transfer complete', '传输完成'],
  'notice.mismatch': ['Checksum mismatch', '校验失败'],
  'notice.mismatchBody': ['{name} did not survive verification', '{name} 未通过完整性校验'],
  'notice.sent': ['Sent to {name}', '已发送给 {name}'],
  'notice.sendFailed': ['Transfer failed verification', '传输未通过校验'],
  'notice.failed': ['Transfer failed', '传输失败'],
  'notice.error': ['Transfer error', '传输出错'],
  'notice.declined': ['Incoming transfer declined', '已拒绝接收'],
  'notice.declinedBody': ['Auto-receive is disabled in Settings.', '「自动接收」在设置中已关闭。'],
  'notice.text': ['Text from {name}', '{name} 发来文字'],

  // views meta
  'view.workspace.title': ['Workspace', '工作台'],
  'view.workspace.sub': ['Your Personal Transfer Space.', '你的个人传输空间。'],
  'view.history.title': ['Recent transfers', '最近传输'],
  'view.history.sub': ['Everything that moved, stored on this device only.', '所有传输记录，仅保存在本机。'],
  'view.favorites.title': ['Favorites', '收藏'],
  'view.favorites.sub': ['Pinned transfers that survive the retention limit.', '置顶的传输记录，不受保留条数限制。'],
  'view.devices.title': ['My devices', '我的设备'],
  'view.devices.sub': ['Pair, verify and manage trusted devices.', '配对、校验与管理受信任设备。'],
  'view.settings.title': ['Settings', '设置'],
  'view.settings.sub': ['Theme, language, storage, relay and privacy.', '主题、语言、存储、中继与隐私。'],

  // misc
  'common.close': ['Close dialog', '关闭'],
  'common.cancel': ['Cancel', '取消'],
  'common.dismiss': ['Dismiss notification', '关闭通知'],
  'common.copy': ['copy', '复制'],
  'common.unknownDevice': ['Unknown device', '未知设备'],
  'time.justNow': ['just now', '刚刚'],
  'time.minutes': ['{n}m ago', '{n} 分钟前'],
  'time.hours': ['{n}h ago', '{n} 小时前'],
  'time.days': ['{n}d ago', '{n} 天前'],
};

let current: Lang = 'en';
const listeners = new Set<() => void>();

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang): void {
  if (current === lang) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive language binding for components. */
export function useLanguage(): Lang {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  if (!entry) return key;
  const template = entry[current === 'zh' ? 1 : 0];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function hasKey(key: string): boolean {
  return key in DICT;
}

export const DICTIONARY_SIZE = Object.keys(DICT).length;
