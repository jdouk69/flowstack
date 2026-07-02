import { motion } from 'framer-motion';

export default function EmptyState({ icon: Icon, title, description, action, compact = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-8'}`}
    >
      <div className={`rounded-2xl bg-muted flex items-center justify-center mb-4 ${compact ? 'w-12 h-12' : 'w-16 h-16'}`}>
        <Icon className={`${compact ? 'h-5 w-5' : 'h-7 w-7'} text-muted-foreground`} />
      </div>
      <h3 className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}>{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}