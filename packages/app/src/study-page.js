function mountStudyAssistant(bank) {
	if (document.querySelector('[data-huahang-study]')) return;
	const normalize = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
	const host = document.createElement('aside');
	host.dataset.huahangStudy = '';
	host.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647';
	const panel = host.attachShadow({ mode: 'closed' });
	panel.innerHTML = '<style>section{background:#173445;color:white;padding:10px 14px;border-radius:9px;font:14px/1.6 system-ui}button{margin-left:8px}small{display:block}</style><section>华航网课助手<button type="button">暂停</button><small></small></section>';
	const status = panel.querySelector('small');
	const button = panel.querySelector('button');
	const handled = new WeakSet();
	let enabled = true;
	let previousVideo;
	let blocked = false;
	function scan() {
		const videos = Array.from(document.querySelectorAll('video'));
		const questions = Array.from(document.querySelectorAll('.TiMu,.questionLi'));
		if (!questions.length && !videos.length) {
			host.remove();
			return;
		}
		if (!host.isConnected) document.body.append(host);
		if (!enabled) return;
		let matched = 0;
		for (const question of questions) {
			const title = question.querySelector('.Zy_TItle .clearfix,.Zy_TItle,.mark_name');
			if (!title) continue;
			const text = normalize(title.innerText).replace(/^\d+[.、]\s*/, '').replace(/^[【\[](单选题|判断题)[】\]]\s*/, '');
			if (!Object.prototype.hasOwnProperty.call(bank, text)) continue;
			const options = Array.from(question.querySelectorAll('li')).filter(option => {
				const label = option.querySelector('.after,label:not(.before)') || option;
				return normalize(label.innerText).replace(/^[a-h][.、:)：]\s*/, '') === normalize(bank[text]);
			});
			if (options.length !== 1) continue;
			const radio = options[0].querySelector('input[type=radio]');
			if (!radio || radio.disabled) continue;
			if (!radio.checked && !handled.has(radio)) radio.click();
			if (radio.checked) {
				handled.add(radio);
				matched++;
			}
		}
		const video = videos.find(item => !item.ended);
		if (video && video !== previousVideo) {
			previousVideo = video;
			blocked = false;
			video.play().catch(() => { blocked = true; });
		}
		const parts = [];
		if (videos.length) parts.push(!video ? '本页视频已播完' : !video.paused ? '视频播放中' : blocked ? '请点击播放器开始播放' : '视频已暂停');
		if (questions.length) parts.push('已匹配 ' + matched + ' / ' + questions.length + ' 题');
		status.textContent = parts.join(' · ');
	}
	button.onclick = () => {
		enabled = !enabled;
		button.textContent = enabled ? '暂停' : '继续';
		if (!enabled) {
			previousVideo?.pause();
			status.textContent = '助手已暂停';
		} else {
			previousVideo = undefined;
			scan();
		}
	};
	scan();
	window.addEventListener('huahang-answer', event => {
		const pair = event.detail;
		if (Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) {
			Object.defineProperty(bank, pair[0], { value: pair[1], configurable: true });
			scan();
		}
	});
	window.setInterval(scan, 1500);
}
