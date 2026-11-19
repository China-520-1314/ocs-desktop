import { app, BrowserWindow, Menu, dialog, webFrameMain } from 'electron';
import pageScript from './study-page.js?raw';
import chineseBank from './bank/javascript-zh.json';
import bank from './huahang-bank';
import { configure, queryYanxi, token } from './yanxi';

const title = '华航网课助手';
const home = 'https://i.chaoxing.com/';
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const answers = new Map(Object.entries({ ...bank, ...chineseBank }).map(([question, answer]) => [normalize(question), answer]));
const script = '(' + pageScript.trim() + ')(' + JSON.stringify(Object.fromEntries(answers)) + ')';

function courseUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && /(^|\.)chaoxing\.com$/.test(url.hostname);
	} catch {
		return false;
	}
}

async function lookup(window: BrowserWindow, question: string) {
	const show = (message: string, detail: string) => dialog.showMessageBox(window, { title, message, detail });
	const answer = answers.get(normalize(question));
	if (answer) return show('华航本地题库', answer);
	try {
		const credential = token();
		if (credential) {
			const result = await queryYanxi(question, credential);
			if (result) return show('言溪题库', result);
		}
	} catch (error) {
		await show('言溪查询未成功', (error as Error).message);
		if (!process.env.HUAHANG_AI_KEY) return;
	}
	const { HUAHANG_AI_URL: endpoint, HUAHANG_AI_MODEL: model, HUAHANG_AI_KEY: key } = process.env;
	if (!endpoint || !model || !key) return show('本地题库未命中', '启动前设置 HUAHANG_AI_URL、HUAHANG_AI_MODEL 和 HUAHANG_AI_KEY 可启用 AI。');
	try {
		const url = new URL(endpoint);
		if (url.protocol !== 'https:') throw new Error('接口地址需要使用 HTTPS');
		const choice = await dialog.showMessageBox(window, { title, message: `将所选题目发送至 ${url.host}？`, detail: question, buttons: ['取消', '使用 AI'], defaultId: 0, cancelId: 0 });
		if (!choice.response) return;
		const result = await fetch(url, {
			method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model, messages: [{ role: 'system', content: '用中文回答题目并简要说明理由。' }, { role: 'user', content: question }] })
		});
		if (!result.ok) throw new Error(`HTTP ${result.status}`);
		const content = (await result.json()).choices?.[0]?.message?.content;
		if (typeof content !== 'string' || !content.trim()) throw new Error('接口未返回答案');
		if (!window.isDestroyed()) await show('AI 参考答案', content);
	} catch (error) {
		if (!window.isDestroyed()) await show('AI 请求失败', error instanceof Error ? error.message : '请检查接口设置');
	}
}

app.setName(title);
app.whenReady().then(() => {
	const window = new BrowserWindow({ title, width: 1180, height: 820, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
	window.on('page-title-updated', event => event.preventDefault());
	const contents = window.webContents;
	contents.on('did-frame-finish-load', (_event, _main, processId, routingId) => {
		const frame = webFrameMain.fromId(processId, routingId);
		if (frame && courseUrl(frame.url)) {
			void frame.executeJavaScript(script).catch(error => {
				if (!frame.detached) console.warn('课程脚本加载失败', error.message);
			});
		}
	});
	contents.on('will-navigate', (event, address) => { if (!courseUrl(address)) event.preventDefault(); });
	contents.setWindowOpenHandler(({ url }) => {
		if (courseUrl(url)) void contents.loadURL(url);
		return { action: 'deny' };
	});
	contents.on('context-menu', (_event, params) => {
		const question = params.selectionText.trim();
		Menu.buildFromTemplate([{ label: '查询选中题目', enabled: courseUrl(params.frameURL || params.pageURL) && question.length > 0 && question.length <= 8000, click: () => { void lookup(window, question); } }, { role: 'copy' }, { role: 'paste' }]).popup({ window });
	});
	Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '学习通首页', click: () => { void contents.loadURL(home); } }, { label: '后退', click: () => { if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); } }, { label: '言溪题库', submenu: [
		{ label: '配置 Token', click: () => { void configure(window); } },
		{ label: '查询本页章节题', click: async () => {
			try {
				const credential = token();
				if (!credential) return void configure(window);
				let count = 0;
				for (const frame of contents.mainFrame.framesInSubtree) {
					if (!courseUrl(frame.url)) continue;
					const address = frame.url;
					const titles: unknown = await frame.executeJavaScript("Array.from(document.querySelectorAll('.TiMu,.questionLi'), root => root.querySelector('.Zy_TItle .clearfix,.Zy_TItle,.mark_name')?.innerText || '')");
					if (!Array.isArray(titles)) continue;
					const unique = new Set<string>();
					for (const raw of titles) {
						if (typeof raw !== 'string' || raw.length > 8000) continue;
						const question = raw.trim().replace(/^\d+[.、]\s*/, '').replace(/^[【\[](单选题|判断题)[】\]]\s*/, '');
						if (question && !answers.has(normalize(question))) unique.add(question);
					}
					for (const question of unique) {
						if (frame.detached || frame.url !== address) break;
						const answer = await queryYanxi(question, credential);
						if (!answer || frame.detached || frame.url !== address) continue;
						await frame.executeJavaScript('window.dispatchEvent(new CustomEvent("huahang-answer",{detail:' + JSON.stringify([normalize(question), answer]) + '}))');
						count++;
					}
				}
				await dialog.showMessageBox(window, { message: '言溪返回 ' + count + ' 条答案', detail: '章节面板会匹配选项文本。也可选中题干右键单独查询。' });
			} catch (error) {
				await dialog.showMessageBox(window, { message: '章节查询中止', detail: (error as Error).message });
			}
		} }
	] }, { label: '查题说明', click: () => { void dialog.showMessageBox(window, { title, message: '选中完整题干，右键选择“查询选中题目”。', detail: `本地题库共 ${answers.size} 道题。` }); } }]));
	void contents.loadURL(home);
});
app.on('window-all-closed', () => app.quit());
