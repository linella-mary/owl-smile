/**
 * Метка соцсети по адресу ссылки из профиля: короткая подпись и цвет плашки (без логотипов).
 * Не узнали сайт — null (показывается 🔗).
 */
export interface SocialMark {
  label: string;
  name: string;
  color: string;
}

const SOCIALS: { hosts: string[]; mark: SocialMark }[] = [
  { hosts: ['t.me', 'telegram.me', 'telegram.org'], mark: { label: 'TG', name: 'Telegram', color: '#229ed9' } },
  { hosts: ['youtube.com', 'youtu.be'], mark: { label: 'YT', name: 'YouTube', color: '#e62117' } },
  { hosts: ['vk.com', 'vk.ru', 'vkvideo.ru', 'live.vkvideo.ru'], mark: { label: 'VK', name: 'ВКонтакте', color: '#0077ff' } },
  { hosts: ['discord.gg', 'discord.com', 'discordapp.com'], mark: { label: 'DS', name: 'Discord', color: '#5865f2' } },
  { hosts: ['twitch.tv'], mark: { label: 'TW', name: 'Twitch', color: '#9146ff' } },
  { hosts: ['x.com', 'twitter.com'], mark: { label: 'X', name: 'X', color: '#3a3a3d' } },
  { hosts: ['instagram.com'], mark: { label: 'IG', name: 'Instagram', color: '#d62976' } },
  { hosts: ['tiktok.com'], mark: { label: 'TT', name: 'TikTok', color: '#25c2c8' } },
  { hosts: ['github.com'], mark: { label: 'GH', name: 'GitHub', color: '#6e5494' } },
  { hosts: ['boosty.to'], mark: { label: 'B', name: 'Boosty', color: '#f15f2c' } },
  { hosts: ['donationalerts.com'], mark: { label: 'DA', name: 'DonationAlerts', color: '#f57507' } },
  { hosts: ['steamcommunity.com', 'store.steampowered.com'], mark: { label: 'ST', name: 'Steam', color: '#1b2838' } },
  { hosts: ['kick.com'], mark: { label: 'K', name: 'Kick', color: '#2e8b00' } },
  { hosts: ['rutube.ru'], mark: { label: 'RT', name: 'Rutube', color: '#100943' } },
];

export function socialMark(url: string): SocialMark | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const s of SOCIALS) if (s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return s.mark;
  return null;
}
