import { Archive } from 'lucide-react';

export default function Logo({ size = 'md', showText = true, className = '' }) {
  const sizes = {
    sm: { box: 'w-7 h-7 rounded-lg', icon: 'h-4 w-4', text: 'text-sm' },
    md: { box: 'w-8 h-8 rounded-xl', icon: 'h-4 w-4', text: 'text-sm' },
    lg: { box: 'w-14 h-14 rounded-2xl', icon: 'h-7 w-7', text: 'text-2xl' },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className={`${s.box} bg-primary flex items-center justify-center shadow-sm`}>
        <Archive className={`${s.icon} text-primary-foreground`} strokeWidth={2.5} />
      </div>
      {showText && <span className={`font-semibold ${s.text}`}>InboxVault</span>}
    </div>
  );
}