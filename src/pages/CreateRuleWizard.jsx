import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, ArrowRight, Mail, Building, Search, Folder, Check, Loader2, FileText, Globe, Lock, Download, ExternalLink, ChevronDown, Lightbulb, Wrench } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DownloadFlow from '@/components/DownloadFlow';

const gmailSearchExamples = [
  { label: 'Invoices from one sender', query: 'from:amazon.com filename:pdf' },
  { label: 'Invoices from multiple senders', query: '(from:tournag@otenet.gr OR from:info@tournas.com.gr) filename:pdf' },
  { label: 'Recent PDF attachments', query: 'has:attachment filename:pdf newer_than:1y' },
  { label: 'Search by keyword', query: 'invoice filename:pdf' },
];

const steps = [
  { num: 1, title: 'Source' },
  { num: 2, title: 'Search Type' },
  { num: 3, title: 'Search' },
  { num: 4, title: 'File Types' },
  { num: 5, title: 'Destination' },
  { num: 6, title: 'Preview' },
];

const searchTypes = [
  { value: 'sender_email', label: 'Sender Email', description: 'Search by who sent the email', icon: Mail },
  { value: 'company_name', label: 'Company Name', description: 'Match company name in sender field', icon: Building },
  { value: 'gmail_search', label: 'Advanced Gmail Search', description: 'Use a custom Gmail search query', icon: Search },
];

function suggestRuleName(data) {
  if (data.search_type === 'sender_email' && data.search_value) {
    const domain = data.search_value.split('@')[1]?.split('.')[0];
    return domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : data.search_value;
  }
  return data.search_value || 'New Workflow';
}

function suggestFolderName(data) {
  const name = data.name || suggestRuleName(data);
  return `${name} Files`;
}

function validateSearch(data) {
  if (!data.search_value?.trim()) return false;
  if (data.search_type === 'sender_email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.search_value);
  }
  if (data.search_type === 'company_name') {
    return data.search_value.trim().length >= 2;
  }
  // gmail_search: accept any non-empty input
  return true;
}

export default function CreateRuleWizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    name: '',
    search_type: 'sender_email',
    search_value: '',
    drive_folder_name: '',
    file_types: ['pdf'],
  });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [savedSupplierId, setSavedSupplierId] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(!!id);
  const [examplesExpanded, setExamplesExpanded] = useState(false);
  const [selectedExample, setSelectedExample] = useState(null);
  const [builderExpanded, setBuilderExpanded] = useState(false);
  const [builder, setBuilder] = useState({
    sender1: '',
    sender2: '',
    keyword: '',
    hasAttachment: false,
    fileType: 'pdf',
    afterDate: '',
    beforeDate: '',
  });

  useEffect(() => {
    if (id) {
      base44.entities.Supplier.get(id).then(s => {
        setData({
          name: s.name || '',
          search_type: s.search_type || 'sender_email',
          search_value: s.search_type === 'sender_email' ? (s.email || '') : (s.keyword || ''),
          drive_folder_name: s.drive_folder_name || '',
          file_types: s.file_types || ['pdf'],
        });
        setLoadingExisting(false);
      }).catch(() => navigate('/rules'));
    }
  }, [id]);

  useEffect(() => {
    if (step === 5) {
      setData(prev => ({
        ...prev,
        name: prev.name || suggestRuleName(prev),
        drive_folder_name: prev.drive_folder_name || suggestFolderName(prev),
      }));
    }
  }, [step]);

  // Clear stale preview when navigating back from step 6
  const handleBack = () => {
    if (step === 6) { setPreview(null); setPreviewLoading(false); }
    if (step > 1) setStep(step - 1);
    else navigate('/rules');
  };

  useEffect(() => {
    if (step === 6 && !preview && !previewLoading) {
      runPreview();
    }
  }, [step]);

  const runPreview = async () => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await base44.functions.invoke('previewResults', {
        search_type: data.search_type,
        email: data.search_type === 'sender_email' ? data.search_value : '',
        keyword: data.search_type !== 'sender_email' ? data.search_value : '',
        file_types: data.file_types,
      });
      setPreview(res.data);
    } catch (e) {
      setPreview({ error: e.response?.data?.error || e.message });
    }
    setPreviewLoading(false);
  };

  const generateQuery = () => {
    const parts = [];
    if (builder.sender1 && builder.sender2) {
      parts.push(`(from:${builder.sender1} OR from:${builder.sender2})`);
    } else if (builder.sender1) {
      parts.push(`from:${builder.sender1}`);
    }
    if (builder.keyword) parts.push(builder.keyword);
    if (builder.hasAttachment || builder.fileType !== 'none') {
      if (builder.fileType === 'pdf') parts.push('filename:pdf');
      else if (builder.fileType === 'word') parts.push('filename:doc OR filename:docx');
      else if (builder.fileType === 'excel') parts.push('filename:xls OR filename:xlsx');
      else if (builder.fileType === 'images') parts.push('filename:jpg OR filename:jpeg OR filename:png OR filename:gif');
      else if (builder.fileType === 'zip') parts.push('filename:zip');
      else if (builder.hasAttachment) parts.push('has:attachment');
    }
    if (builder.afterDate) parts.push(`after:${builder.afterDate.replace(/-/g, '/')}`);
    if (builder.beforeDate) parts.push(`before:${builder.beforeDate.replace(/-/g, '/')}`);
    return parts.join(' ');
  };

  const canProceed = () => {
    if (step === 1) return true;
    if (step === 2) return true;
    if (step === 3) return validateSearch(data);
    if (step === 4) return true;
    if (step === 5) return data.name?.trim() && data.drive_folder_name?.trim();
    return true;
  };

  const handleSave = async (downloadAfter) => {
    setSaving(true);
    const payload = {
      name: data.name,
      search_type: data.search_type,
      email: data.search_type === 'sender_email' ? data.search_value : '',
      keyword: data.search_type !== 'sender_email' ? data.search_value : '',
      drive_folder_name: data.drive_folder_name,
      file_types: data.file_types,
    };

    let savedId = id;
    try {
      if (id) {
        await base44.entities.Supplier.update(id, payload);
      } else {
        const saved = await base44.entities.Supplier.create(payload);
        savedId = saved.id;
      }

      if (downloadAfter && savedId) {
        setSavedSupplierId(savedId);
        setDownloadOpen(true);
        setSaving(false);
      } else {
        navigate('/rules');
      }
    } catch (e) {
      alert(e.message || 'Failed to save rule');
      setSaving(false);
    }
  };

  if (loadingExisting) {
    return (
      <div className="p-6 sm:p-8 lg:p-12 max-w-2xl mx-auto">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-8" />
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 lg:p-12 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate('/rules')} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{id ? 'Edit Workflow' : 'New Workflow'}</h1>
          <p className="text-sm text-muted-foreground">Step {step} of {steps.length}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="hidden sm:flex items-center mb-8">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-2 ${i < step - 1 ? 'text-primary' : i === step - 1 ? 'text-foreground' : 'text-muted-foreground'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
                i < step - 1 ? 'bg-primary border-primary text-primary-foreground' :
                i === step - 1 ? 'border-primary text-primary' : 'border-muted text-muted-foreground'
              }`}>
                {i < step - 1 ? <Check className="h-3.5 w-3.5" /> : s.num}
              </div>
              <span className="text-xs font-medium hidden md:block">{s.title}</span>
            </div>
            {i < steps.length - 1 && <div className={`h-0.5 flex-1 mx-2 ${i < step - 1 ? 'bg-primary' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Where should we search?</h2>
              <p className="text-sm text-muted-foreground mb-6">Choose your email provider</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-primary bg-primary/5">
                  <Mail className="h-5 w-5 text-primary" />
                  <div className="flex-1">
                    <p className="font-medium">Gmail</p>
                    <p className="text-xs text-muted-foreground">Connected</p>
                  </div>
                  <Check className="h-5 w-5 text-primary" />
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl border border-muted opacity-50 cursor-not-allowed">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="font-medium">Outlook</p>
                    <p className="text-xs text-muted-foreground">Coming soon</p>
                  </div>
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">How would you like to search?</h2>
              <p className="text-sm text-muted-foreground mb-6">Choose how to find emails with attachments</p>
              <div className="space-y-2">
                {searchTypes.map(type => {
                  const Icon = type.icon;
                  const selected = data.search_type === type.value;
                  return (
                    <div key={type.value} onClick={() => setData({ ...data, search_type: type.value })}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}`}>
                      <Icon className={`h-5 w-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="flex-1">
                        <p className="font-medium">{type.label}</p>
                        <p className="text-xs text-muted-foreground">{type.description}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-primary bg-primary' : 'border-muted'}`}>
                        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Enter your search</h2>
              <p className="text-sm text-muted-foreground mb-6">
                {data.search_type === 'sender_email' ? "Enter the sender's email address" :
                 data.search_type === 'company_name' ? 'Enter the company name to search for' :
                 'Enter your Gmail search query using any supported operators'}
              </p>
              <div className="space-y-3">
                <Input
                  autoFocus
                  type={data.search_type === 'sender_email' ? 'email' : 'text'}
                  placeholder={data.search_type === 'sender_email' ? 'billing@acme.com' : data.search_type === 'company_name' ? 'Acme Corp' : 'from:acme.com has:attachment filename:pdf'}
                  value={data.search_value}
                  onChange={e => setData({ ...data, search_value: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && canProceed()) setStep(step + 1); }}
                  className="h-12"
                />
                {data.search_type === 'gmail_search' && (
                  <>
                    {/* Search Builder */}
                    <div className="rounded-xl border border-border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setBuilderExpanded(!builderExpanded)}
                        className="w-full flex items-center gap-2 p-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Wrench className="h-4 w-4" />
                        Need help building a Gmail search?
                        <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${builderExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      {builderExpanded && (
                        <div className="p-4 pt-0 space-y-4 animate-fade-in">
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Sender Email</Label>
                              <Input
                                type="email"
                                placeholder="tournag@otenet.gr"
                                value={builder.sender1}
                                onChange={e => setBuilder({ ...builder, sender1: e.target.value })}
                                className="h-9 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Additional Sender Email (optional)</Label>
                              <Input
                                type="email"
                                placeholder="info@tournas.com.gr"
                                value={builder.sender2}
                                onChange={e => setBuilder({ ...builder, sender2: e.target.value })}
                                className="h-9 text-sm"
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Keyword (optional)</Label>
                            <Input
                              type="text"
                              placeholder="invoice"
                              value={builder.keyword}
                              onChange={e => setBuilder({ ...builder, keyword: e.target.value })}
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id="has-attachment"
                                checked={builder.hasAttachment}
                                onCheckedChange={v => setBuilder({ ...builder, hasAttachment: v })}
                              />
                              <Label htmlFor="has-attachment" className="text-sm cursor-pointer">Has Attachment</Label>
                            </div>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">File Type</Label>
                              <Select
                                value={builder.fileType}
                                onValueChange={v => setBuilder({ ...builder, fileType: v })}
                              >
                                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Any</SelectItem>
                                  <SelectItem value="pdf">PDF</SelectItem>
                                  <SelectItem value="word">Word</SelectItem>
                                  <SelectItem value="excel">Excel</SelectItem>
                                  <SelectItem value="images">Images</SelectItem>
                                  <SelectItem value="zip">ZIP</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">After</Label>
                              <Input
                                type="date"
                                value={builder.afterDate}
                                onChange={e => setBuilder({ ...builder, afterDate: e.target.value })}
                                className="h-9 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Before</Label>
                              <Input
                                type="date"
                                value={builder.beforeDate}
                                onChange={e => setBuilder({ ...builder, beforeDate: e.target.value })}
                                className="h-9 text-sm"
                              />
                            </div>
                          </div>

                          {generateQuery() && (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Generated query:</Label>
                              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                                <code className="text-sm font-mono break-all">{generateQuery()}</code>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                className="gap-2 w-full"
                                onClick={() => {
                                  setData({ ...data, search_value: generateQuery() });
                                  setBuilderExpanded(false);
                                }}
                              >
                                <Check className="h-3.5 w-3.5" /> Use This Query
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Search Examples */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Supports all Gmail search operators.</span>
                      <button
                        type="button"
                        onClick={() => setExamplesExpanded(!examplesExpanded)}
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <Lightbulb className="h-3 w-3" />
                        Search Examples
                        <ChevronDown className={`h-3 w-3 transition-transform ${examplesExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>

                    {examplesExpanded && (
                      <div className="space-y-2 animate-fade-in">
                        <p className="text-xs text-muted-foreground">Click an example to use it:</p>
                        {gmailSearchExamples.map((ex, i) => {
                          const isSelected = selectedExample === i;
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => {
                                setData({ ...data, search_value: ex.query });
                                setSelectedExample(i);
                              }}
                              className={`w-full text-left p-3 rounded-xl border transition-all ${
                                isSelected
                                  ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                  : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
                              }`}
                            >
                              <p className="text-sm font-medium">{ex.label}</p>
                              <code className="text-xs text-muted-foreground font-mono">{ex.query}</code>
                            </button>
                          );
                        })}
                        <a
                          href="https://support.google.com/mail/answer/7190"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-1"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Learn Gmail Search
                        </a>
                      </div>
                    )}
                  </>
                )}
                {data.search_value && !validateSearch(data) && (
                  <p className="text-sm text-destructive">
                    {data.search_type === 'sender_email' ? 'Please enter a valid email address' : 'Please enter at least 2 characters'}
                  </p>
                )}
                {data.search_value && validateSearch(data) && (
                  <p className="text-sm text-emerald-600 flex items-center gap-1">
                    <Check className="h-4 w-4" /> Looks good!
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Choose file types</h2>
              <p className="text-sm text-muted-foreground mb-6">Select which attachments to download</p>
              <div className="space-y-2">
                {[
                  { value: 'pdf', label: 'PDF Documents', desc: '.pdf' },
                  { value: 'images', label: 'Images', desc: '.jpg, .jpeg, .png, .heic' },
                  { value: 'word', label: 'Word Documents', desc: '.doc, .docx' },
                  { value: 'excel', label: 'Excel Spreadsheets', desc: '.xls, .xlsx' },
                  { value: 'zip', label: 'ZIP Archives', desc: '.zip' },
                ].map(ft => {
                  const selected = data.file_types?.includes(ft.value);
                  return (
                    <div key={ft.value} onClick={() => {
                      const current = data.file_types || [];
                      const updated = selected
                        ? current.filter(t => t !== ft.value)
                        : [...current, ft.value];
                      if (updated.length === 0) return;
                      setData({ ...data, file_types: updated });
                    }}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}`}>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${selected ? 'border-primary bg-primary' : 'border-muted'}`}>
                        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{ft.label}</p>
                        <p className="text-xs text-muted-foreground">{ft.desc}</p>
                      </div>
                      <FileText className={`h-5 w-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-4">At least one file type must be selected.</p>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Name your rule & choose destination</h2>
              <p className="text-sm text-muted-foreground mb-6">We've suggested names based on your search</p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rule-name">Workflow Name</Label>
                  <Input id="rule-name" value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="My Download Rule" className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="folder-name">Destination Google Drive Folder</Label>
                  <div className="relative">
                    <Folder className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input id="folder-name" value={data.drive_folder_name} onChange={e => setData({ ...data, drive_folder_name: e.target.value })} className="h-12 pl-10" placeholder="Acme Invoices" />
                  </div>
                  <p className="text-xs text-muted-foreground">We'll create this folder in your Google Drive if it doesn't exist</p>
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Preview results</h2>
              <p className="text-sm text-muted-foreground mb-6">Here's what we found</p>

              {previewLoading ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-24 bg-muted rounded-xl animate-pulse" />
                    <div className="h-24 bg-muted rounded-xl animate-pulse" />
                  </div>
                  {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />)}
                </div>
              ) : preview?.error ? (
                <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-sm text-destructive">
                  {preview.error}
                </div>
              ) : preview ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-muted/50 text-center">
                      <p className="text-3xl font-bold">{preview.emails_found}</p>
                      <p className="text-xs text-muted-foreground mt-1">Emails Found</p>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/50 text-center">
                      <p className="text-3xl font-bold">{preview.files_found}</p>
                      <p className="text-xs text-muted-foreground mt-1">Files Found</p>
                    </div>
                  </div>

                  {preview.estimated_time_seconds > 0 && (
                    <p className="text-sm text-muted-foreground text-center">
                      Estimated download time: ~{Math.max(1, Math.ceil(preview.estimated_time_seconds / 60))} min
                    </p>
                  )}

                  {preview.sample_emails?.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Sample emails</p>
                      <div className="space-y-1.5">
                        {preview.sample_emails.map((email, i) => (
                          <div key={i} className="p-3 rounded-lg bg-muted/30 text-sm">
                            <p className="font-medium truncate">{email.subject || '(no subject)'}</p>
                            <p className="text-xs text-muted-foreground truncate">{email.from}{email.date ? ' · ' + new Date(email.date).toLocaleDateString() : ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.files_found === 0 && (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-700 dark:text-amber-400">
                      No files found with these search criteria. Try adjusting your search.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t">
        <Button variant="ghost" onClick={handleBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> {step > 1 ? 'Back' : 'Cancel'}
        </Button>
        <div className="flex gap-2">
          {step < 6 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()} className="gap-2">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
                Save Workflow
              </Button>
              <Button onClick={() => handleSave(true)} disabled={saving || preview?.files_found === 0} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download Files
              </Button>
            </>
          )}
        </div>
      </div>

      {savedSupplierId && (
        <DownloadFlow
          open={downloadOpen}
          onClose={() => { setDownloadOpen(false); navigate('/rules'); }}
          supplierId={savedSupplierId}
          suppliers={[{ id: savedSupplierId, name: data.name }]}
        />
      )}
    </div>
  );
}