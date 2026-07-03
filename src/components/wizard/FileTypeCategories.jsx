import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Image as ImageIcon, Archive, Check, ChevronDown, Layers, Minus } from 'lucide-react';

const CATEGORIES = [
  {
    id: 'documents',
    label: 'Documents',
    icon: FileText,
    description: 'Office documents and text files',
    types: [
      { id: 'pdf', label: 'PDF', extensions: ['pdf'] },
      { id: 'word', label: 'Word', extensions: ['doc', 'docx'] },
      { id: 'excel', label: 'Excel', extensions: ['xls', 'xlsx'] },
      { id: 'powerpoint', label: 'PowerPoint', extensions: ['ppt', 'pptx'] },
    ],
  },
  {
    id: 'photos',
    label: 'Photos',
    icon: ImageIcon,
    description: 'Image files and pictures',
    types: [
      { id: 'images', label: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'tif', 'tiff'] },
    ],
  },
  {
    id: 'archives',
    label: 'Archives',
    icon: Archive,
    description: 'Compressed archive files',
    types: [
      { id: 'zip', label: 'ZIP', extensions: ['zip'] },
    ],
  },
];

const ALL_TYPE_IDS = CATEGORIES.flatMap(c => c.types.map(t => t.id));

function getCategoryState(category, selected) {
  const count = category.types.filter(t => selected.includes(t.id)).length;
  if (count === 0) return 'unchecked';
  if (count === category.types.length) return 'checked';
  return 'indeterminate';
}

function TriCheckbox({ state }) {
  if (state === 'checked') {
    return (
      <div className="w-5 h-5 rounded-md border-2 border-primary bg-primary flex items-center justify-center shrink-0">
        <Check className="h-3 w-3 text-primary-foreground" />
      </div>
    );
  }
  if (state === 'indeterminate') {
    return (
      <div className="w-5 h-5 rounded-md border-2 border-primary bg-primary flex items-center justify-center shrink-0">
        <Minus className="h-3 w-3 text-primary-foreground" />
      </div>
    );
  }
  return <div className="w-5 h-5 rounded-md border-2 border-muted shrink-0" />;
}

export default function FileTypeCategories({ value = [], onChange }) {
  const [expanded, setExpanded] = useState({ documents: true, photos: false, archives: false });
  const selected = value || [];

  const allCount = ALL_TYPE_IDS.filter(id => selected.includes(id)).length;
  const allState = allCount === 0 ? 'unchecked' : allCount === ALL_TYPE_IDS.length ? 'checked' : 'indeterminate';

  const toggleAll = () => {
    onChange(allState === 'checked' ? [] : [...ALL_TYPE_IDS]);
  };

  const toggleCategory = (category) => {
    const state = getCategoryState(category, selected);
    if (state === 'checked') {
      onChange(selected.filter(id => !category.types.some(t => t.id === id)));
    } else {
      const next = [...selected];
      category.types.forEach(t => { if (!next.includes(t.id)) next.push(t.id); });
      onChange(next);
    }
  };

  const toggleType = (typeId) => {
    onChange(selected.includes(typeId) ? selected.filter(id => id !== typeId) : [...selected, typeId]);
  };

  return (
    <div>
      {/* All Attachments */}
      <div
        onClick={toggleAll}
        className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors mb-4 ${allState !== 'unchecked' ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}`}
      >
        <TriCheckbox state={allState} />
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">All Supported Types</p>
          <p className="text-xs text-muted-foreground">Download every supported file type</p>
        </div>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0">{ALL_TYPE_IDS.length} types</span>
      </div>

      {/* Helper text */}
      <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border">
        <p className="text-xs text-muted-foreground leading-relaxed">
          All Supported Types downloads every file type InboxVault currently supports. Some unsupported attachments like CSV, TXT, DWG, MP4, and others will be ignored.
        </p>
      </div>

      {/* Category cards */}
      <div className="space-y-3">
        {CATEGORIES.map(category => {
          const Icon = category.icon;
          const catState = getCategoryState(category, selected);
          const isExpanded = expanded[category.id];
          const formatCount = category.types.reduce((sum, t) => sum + t.extensions.length, 0);

          return (
            <div
              key={category.id}
              className={`rounded-xl border-2 transition-colors ${catState !== 'unchecked' ? 'border-primary/40' : 'border-muted'}`}
            >
              <div className="flex items-center gap-3 p-4">
                <div onClick={(e) => { e.stopPropagation(); toggleCategory(category); }} className="cursor-pointer shrink-0">
                  <TriCheckbox state={catState} />
                </div>
                <div
                  onClick={() => setExpanded(prev => ({ ...prev, [category.id]: !prev[category.id] }))}
                  className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${catState !== 'unchecked' ? 'bg-primary/10' : 'bg-muted'}`}>
                    <Icon className={`h-5 w-5 ${catState !== 'unchecked' ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{category.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{category.description}</p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0">
                    {formatCount} {formatCount === 1 ? 'format' : 'formats'}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-1 border-t border-border/50">
                      {category.types.map(type => {
                        const typeSelected = selected.includes(type.id);
                        return (
                          <div
                            key={type.id}
                            onClick={() => toggleType(type.id)}
                            className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                          >
                            <TriCheckbox state={typeSelected ? 'checked' : 'unchecked'} />
                            <span className="text-sm font-medium flex-1">{type.label}</span>
                            <div className="flex flex-wrap gap-1 justify-end">
                              {type.extensions.map(ext => (
                                <span key={ext} className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                                  .{ext}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}