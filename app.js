import { MqttLiteClient } from './mqtt-lite.js';
import { validateCredentials, formatClock, makeClientId } from './app-core.js';

const BROKER_URL = 'wss://sfe0f5f7.ala.cn-hangzhou.emqxsl.cn:8084/mqtt';
const MQTT_TOPIC = 'home/pc/wol';
const MQTT_PAYLOAD = 'wake';
const DEFAULT_USERNAME = 'pc-wol-controller';
const STORAGE_KEY = 'pc-wol-web.credentials';

const $ = (id) => document.getElementById(id);
const ui = {
  statusPill: $('statusPill'), statusText: $('statusText'), channelMetric: $('channelMetric'),
  wakeButton: $('wakeButton'), reconnectButton: $('reconnectButton'), lastAction: $('lastAction'),
  settingsButton: $('settingsButton'), settingsModal: $('settingsModal'), closeSettings: $('closeSettings'),
  usernameInput: $('usernameInput'), passwordInput: $('passwordInput'), rememberInput: $('rememberInput'),
  togglePassword: $('togglePassword'), saveConnectButton: $('saveConnectButton'), forgetButton: $('forgetButton'),
  formError: $('formError'), confirmModal: $('confirmModal'), cancelWake: $('cancelWake'), confirmWake: $('confirmWake'),
  toast: $('toast'),
};

let client = null;
let toastTimer = null;
let reconnectTimer = null;
let currentCredentials = { username: DEFAULT_USERNAME, password: '', remember: false };

const show = (element) => element.classList.remove('hidden');
const hide = (element) => element.classList.add('hidden');

function setConnectionState(state, detail = '') {
  const labels = {
    disconnected: '尚未连接', connecting: '正在连接', connected: '云端已连接', error: '连接异常',
  };
  ui.statusPill.dataset.state = state;
  ui.statusText.textContent = detail || labels[state] || state;
  ui.channelMetric.textContent = state === 'connected' ? 'WSS 8084 · 在线' : labels[state] || '未知';
  ui.wakeButton.disabled = state !== 'connected';
  ui.reconnectButton.classList.toggle('hidden', state === 'connected' || state === 'connecting');
}

function toast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  show(ui.toast);
  toastTimer = setTimeout(() => hide(ui.toast), 2600);
}

function loadCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.username && saved?.password) {
      return { username: saved.username, password: saved.password, remember: true };
    }
  } catch {}
  return { username: DEFAULT_USERNAME, password: '', remember: false };
}

function saveCredentials(credentials) {
  if (credentials.remember) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ username: credentials.username, password: credentials.password }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function openSettings() {
  ui.usernameInput.value = currentCredentials.username || DEFAULT_USERNAME;
  ui.passwordInput.value = currentCredentials.password || '';
  ui.rememberInput.checked = currentCredentials.remember;
  ui.passwordInput.type = 'password';
  ui.togglePassword.textContent = '显示';
  hide(ui.formError);
  show(ui.settingsModal);
}

function closeSettings() { hide(ui.settingsModal); }

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!currentCredentials.password || !navigator.onLine) return;
  reconnectTimer = setTimeout(() => connectBroker(false), 3500);
}

async function connectBroker(showErrors = true) {
  clearTimeout(reconnectTimer);
  if (!currentCredentials.password) {
    setConnectionState('disconnected');
    openSettings();
    return;
  }

  try { client?.disconnect(); } catch {}
  setConnectionState('connecting');
  client = new MqttLiteClient({
    url: BROKER_URL,
    username: currentCredentials.username,
    password: currentCredentials.password,
    clientId: makeClientId(),
    keepAlive: 30,
  });

  client.onState((state) => {
    if (state === 'connected') setConnectionState('connected');
    if (state === 'disconnected') {
      setConnectionState('disconnected');
      scheduleReconnect();
    }
  });
  client.onError((error) => {
    setConnectionState('error', error.message);
    if (showErrors) toast(error.message);
  });

  try {
    await client.connect();
  } catch (error) {
    setConnectionState('error', error.message);
    if (showErrors) toast(error.message);
  }
}

ui.settingsButton.addEventListener('click', openSettings);
ui.closeSettings.addEventListener('click', closeSettings);
ui.settingsModal.addEventListener('click', (event) => { if (event.target === ui.settingsModal) closeSettings(); });
ui.confirmModal.addEventListener('click', (event) => { if (event.target === ui.confirmModal) hide(ui.confirmModal); });

ui.togglePassword.addEventListener('click', () => {
  const visible = ui.passwordInput.type === 'text';
  ui.passwordInput.type = visible ? 'password' : 'text';
  ui.togglePassword.textContent = visible ? '显示' : '隐藏';
});

ui.saveConnectButton.addEventListener('click', async () => {
  const username = ui.usernameInput.value.trim();
  const password = ui.passwordInput.value;
  const validation = validateCredentials(username, password);
  if (!validation.ok) {
    ui.formError.textContent = validation.message;
    show(ui.formError);
    return;
  }
  hide(ui.formError);
  currentCredentials = { username, password, remember: ui.rememberInput.checked };
  saveCredentials(currentCredentials);
  closeSettings();
  await connectBroker(true);
});

ui.forgetButton.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  currentCredentials = { username: DEFAULT_USERNAME, password: '', remember: false };
  try { client?.disconnect(); } catch {}
  ui.usernameInput.value = DEFAULT_USERNAME;
  ui.passwordInput.value = '';
  ui.rememberInput.checked = false;
  setConnectionState('disconnected');
  toast('已清除本机保存的信息');
});

ui.reconnectButton.addEventListener('click', () => connectBroker(true));
ui.wakeButton.addEventListener('click', () => show(ui.confirmModal));
ui.cancelWake.addEventListener('click', () => hide(ui.confirmModal));

ui.confirmWake.addEventListener('click', () => {
  try {
    client.publish(MQTT_TOPIC, MQTT_PAYLOAD);
    const time = formatClock();
    ui.lastAction.textContent = `${time} · 开机指令已发送`;
    hide(ui.confirmModal);
    toast('开机指令已发送');
    if (navigator.vibrate) navigator.vibrate(35);
  } catch (error) {
    hide(ui.confirmModal);
    toast(error.message);
    setConnectionState('error', '发送失败');
  }
});

window.addEventListener('online', () => connectBroker(false));
window.addEventListener('offline', () => {
  setConnectionState('error', '设备当前离线');
  try { client?.disconnect(); } catch {}
});
window.addEventListener('beforeunload', () => { try { client?.disconnect(); } catch {} });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentCredentials.password && (!client || !client.connected)) {
    connectBroker(false);
  }
});

currentCredentials = loadCredentials();
if (currentCredentials.password) {
  connectBroker(false);
} else {
  setConnectionState('disconnected');
  setTimeout(openSettings, 280);
}
