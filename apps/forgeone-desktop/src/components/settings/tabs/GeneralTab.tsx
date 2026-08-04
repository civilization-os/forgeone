import { useTranslation } from 'react-i18next'

export default function GeneralTab() {
  const { t, i18n } = useTranslation()

  return (
    <div className="space-y-5 max-w-lg">
      <div className="bg-white p-4 rounded-xl border border-[#E8E8E6] shadow-sm space-y-3">
        <h5 className="text-xs font-semibold text-[#1A1C1B]">{t('settings.proxy')}</h5>
        <input
          type="text"
          placeholder="socks5://127.0.0.1:7890"
          className="w-full px-3 py-2 border border-[#E2E3E1] rounded-lg text-xs outline-none focus:border-[#2D63ED] bg-[#F9F9F7] font-mono"
        />
        <p className="text-[11px] text-[#76777B]">支持全局 Socks5 / HTTP 网络代理，用于模型 API 访问与远程 MCP 通信。</p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-[#E8E8E6] shadow-sm space-y-3">
        <h5 className="text-xs font-semibold text-[#1A1C1B]">{t('settings.language')}</h5>
        <select
          value={i18n.language.startsWith('zh') ? 'zh' : 'en'}
          onChange={(e) => i18n.changeLanguage(e.target.value)}
          className="w-full px-3 py-2 border border-[#E2E3E1] rounded-lg text-xs outline-none focus:border-[#2D63ED] bg-[#F9F9F7]"
        >
          <option value="zh">中文 (Simplified Chinese)</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>
  )
}
