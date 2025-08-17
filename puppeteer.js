const puppeteer = require('puppeteer-extra');
const path = require('path');

const EXT1 = 'TokenPocket钱包扩展安装路径-待替换'; // TokenPocket钱包扩展安装路径，两边的单引号不要搞丢了
const EXT2 = 'PPP Tools扩展安装路径-待替换'; // PPP Tools扩展安装路径，两边的单引号不要搞丢了
const CHROME_WORK_DIR = 'Chrome扩展数据持久化目录-待替换';  //Chrome扩展数据持久化目录, 两边的单引号不要搞丢了
const WALLET_EXTENSION_ID = 'mfgccjchihfkkindfppnaooecgfneiii'; // TokenPocket 钱包扩展ID


const userDataDirs = [
    'chrome-data1',
    'chrome-data2',
    // 'chrome-data3',
    // 'chrome-data4',
    // 配几个数据目录就是调起几个浏览器，要在Chrome扩展数据持久化目录下把数据目录提前建好

].map(dir => path.resolve(`${CHROME_WORK_DIR}/${dir}`));

function getTimestamp() {
    return `[${new Date().toLocaleTimeString('en-US', { hour12: false })}]`;
}

// 启动单个 Puppeteer 实例并注入监听逻辑
async function launchInstance(userDataDir) {
    const browser = await puppeteer.launch({
        headless: false,
        userDataDir,
        args: [
            '--no-sandbox',
            `--disable-extensions-except=${EXT1},${EXT2}`,
            `--load-extension=${EXT1},${EXT2}`
        ],
        defaultViewport: null,
        protocolTimeout: 300000 // 5分钟
    });

    console.log(`${getTimestamp()} ✅ 启动浏览器实例: ${userDataDir}`);

    browser.on('targetcreated', async target => {
        if (target.type() !== 'page') return;

        const targetUrl = target.url();
        if (!targetUrl || targetUrl === 'about:blank' || targetUrl.startsWith('chrome://')) return;

        // 🚨 只处理钱包弹窗，其它页面忽略
        if (!targetUrl.startsWith(`chrome-extension://${WALLET_EXTENSION_ID}/`)) {
            return;
        }

        try {
            const page = await target.page();
            try {
                await page.waitForNavigation({
                    waitUntil: 'domcontentloaded',
                    timeout: 600
                });
            } catch (e) {
                console.error(`${getTimestamp()} [${userDataDir}] ❗ [钱包弹窗] 加载超时，强制关闭`);
                if (!page.isClosed()) await page.close();
                return;
            }

            console.log(`${getTimestamp()} [${userDataDir}] 🟢 [钱包弹窗] 检测到: ${page.url()}`);

            // 注入自动点击逻辑
            await page.evaluate(() => {
                (async () => {
                    const maxDuration = 15000;
                    const startTime = Date.now();

                    function sleep(ms) {
                        return new Promise(resolve => setTimeout(resolve, ms));
                    }

                    function clickLastEnabledBtn() {
                        const btns = Array.from(document.querySelectorAll('button')).filter(btn => !btn.disabled);
                        if (btns.length > 0) {
                            const lastBtn = btns[btns.length - 1];
                            const text = lastBtn.innerText.replace(/\s+/g, '');
                            if (['连接', '确认', '取消', '拒绝',`签名`].includes(text)) {
                                lastBtn.click();
                                console.log('✅ [钱包弹窗] 点击按钮:', lastBtn.innerText);
                            }
                        }
                    }

                    while (Date.now() - startTime < maxDuration) {
                        clickLastEnabledBtn();
                        await sleep(100);
                    }
                })();
            });

            console.log(`${getTimestamp()} [${userDataDir}] ✅ [钱包弹窗] 脚本注入完成`);

        } catch (e) {
            console.error(`${getTimestamp()} [${userDataDir}] ❗ [钱包弹窗] 处理失败:`, e.message);
        }
    });

    const workerTarget = await browser.waitForTarget(
        target => target.type() === 'service_worker' && target.url().endsWith('background.js')
    );
    await workerTarget.worker();

    // 每30分钟打开并自动关闭 TokenPocket popup页面以保持活跃,防止TokenPocket锁屏
    setInterval(async () => {
        try {
            const EXT_URL = `chrome-extension://${WALLET_EXTENSION_ID}/popup.html`;
            const popup = await browser.newPage();
            await popup.goto(EXT_URL);
            console.log(`${getTimestamp()} [${userDataDir}] 🟢 定时打开 TokenPocket 页面`);

            // 注入模拟活动
            await popup.evaluate(() => {
                const evt = new MouseEvent("mousemove", {
                    bubbles: true
                });
                window.dispatchEvent(evt);
                console.log('💡 模拟 mousemove 活动防锁屏');
            });

            // 100秒后关闭页面
            setTimeout(async () => {
                try {
                    await popup.close();
                    console.log(`${getTimestamp()} [${userDataDir}] 🔴 钱包保活页面已关闭`);
                } catch (e) {
                    console.log(`${getTimestamp()} [${userDataDir}] ❗ 钱包保活页面关闭失败:`, e);
                }
            }, 100000);

        } catch (err) {
            console.error(`${getTimestamp()} [${userDataDir}] ❗  钱包保活定时任务失败: ${err.message}`);
        }

    }, 30 * 60 * 1000);
}
// 启动所有实例
(async () => {
    for (const dir of userDataDirs) {
        launchInstance(dir);
    }
    console.log(`${getTimestamp()} ✨ 所有 Puppeteer 实例已启动`);
})();
