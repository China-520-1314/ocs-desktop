import { app, clipboard, dialog, net, safeStorage, BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';

const tokenFile = () => path.join(app.getPath('userData'), 'yanxi-token.bin');

export function token() {
	if (process.env.HUAHANG_YANXI_TOKEN) return process.env.HUAHANG_YANXI_TOKEN.trim();
	return existsSync(tokenFile()) ? safeStorage.decryptString(readFileSync(tokenFile())) : '';
}

export async function configure(window: BrowserWindow) {
	const choice = await dialog.showMessageBox(window, {
		message: '配置言溪题库',
		detail: '从言溪官网复制个人 Token，再点击保存。查题时会把题干发送给言溪，并可能消耗账户额度。',
		buttons: ['取消', '保存剪贴板中的 Token', '清除已保存的 Token'], cancelId: 0, defaultId: 0
	});
	if (!choice.response) return;
	try {
		if (choice.response === 2) {
			if (existsSync(tokenFile())) unlinkSync(tokenFile());
			return;
		}
		const value = clipboard.readText().trim();
		if (!value || value.length > 512 || /\s/.test(value)) throw new Error('请先复制单个 Token。');
		writeFileSync(tokenFile(), safeStorage.encryptString(value));
		await dialog.showMessageBox(window, { message: '言溪 Token 已保存' });
	} catch (error) {
		await dialog.showMessageBox(window, { message: '配置失败', detail: (error as Error).message });
	}
}

export async function queryYanxi(question: string, credential: string): Promise<string> {
	const url = new URL('https://tk.enncy.cn/query');
	url.searchParams.set('token', credential);
	url.searchParams.set('title', question);
	const response = await net.fetch(url.toString(), { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000) });
	if (!response.ok) throw new Error('言溪请求失败 HTTP ' + response.status);
	const result = await response.json();
	if (Number(result.code) !== 1) throw new Error(String(result.data?.answer || result.message || '查询失败').replaceAll(credential, '***').slice(0, 300));
	return typeof result.data?.answer === 'string' ? result.data.answer.trim() : '';
}
