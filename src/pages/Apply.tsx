import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

const SPECIALIZATIONS = [
  { group: 'AI & Data', options: ['Artificial Intelligence', 'Machine Learning', 'Data Science & Analytics', 'n8n Workflow Automation'] },
  { group: 'Development', options: ['Full Stack Web Development', 'Web Development Fundamentals (JavaScript)', 'Cyber Security', 'Software Testing', 'Salesforce'] },
  { group: 'Design & Marketing', options: ['UI/UX Design', 'Master AI Marketing with ChatGPT', 'Complete Digital Marketing Mastery', 'Digital Marketing (Beginner)'] },
  { group: 'Engineering', options: ['VLSI Design', 'Embedded Systems', 'AutoCAD'] },
  { group: 'Business', options: ['Finance', 'HR Management'] },
];

export default function Apply() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref') || '';
  const formSlug = (searchParams.get('form') || '').trim().toLowerCase();
  const isNormalForm = formSlug === 'normal';
  const isDirectFormLink = formSlug.length > 0;
  const isBuiltinFormSlug = formSlug === 'normal' || formSlug === 'default';
  const isCustomForm = formSlug.length > 0 && !isBuiltinFormSlug;
  const { toast } = useToast();
  /** Any `?form=` link should open the form immediately (normal/default were incorrectly left on landing while landing UI is hidden for those slugs). */
  const [view, setView] = useState<'landing' | 'form'>(isDirectFormLink ? 'form' : 'landing');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dynamicFields, setDynamicFields] = useState<Array<{ id?: string; key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', specialization: '', otherSpecialization: '', college: '', year: '' });
  const [formBrand, setFormBrand] = useState<{ companyName: string; logoUrl: string; formBg: string; fieldBg: string; textColor: string }>({
    companyName: 'Student Survey Form',
    logoUrl: '',
    formBg: '#0A1410',
    fieldBg: '#000000',
    textColor: '#ffffff',
  });
  const effectiveDynamicFields = (() => {
    if (!isCustomForm) return dynamicFields;
    const hasName = dynamicFields.some((f) => ['name', 'full_name'].includes((f.key || '').toLowerCase()));
    const hasEmail = dynamicFields.some((f) => (f.key || '').toLowerCase() === 'email');
    const next = [...dynamicFields];
    if (!hasName) {
      next.unshift({ id: 'system_name', key: 'name', label: 'Full Name', type: 'text', required: true, placeholder: 'Your full name' });
    }
    if (!hasEmail) {
      next.push({ id: 'system_email', key: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'you@domain.com' });
    }
    return next.map((f) => {
      const k = (f.key || '').toLowerCase();
      if (k === 'email') return { ...f, required: true, type: 'email' };
      if (k === 'name' || k === 'full_name') return { ...f, required: true, type: 'text' };
      return f;
    });
  })();

  const handleChange = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));
  const handleDynamicFieldChange = (key: string, value: string) => setFormValues((prev) => ({ ...prev, [key]: value }));
  const handlePhoneChange = (value: string) => {
    const phoneDigits = value.replace(/\D/g, '').slice(0, 10);
    handleChange('phone', phoneDigits);
  };

  const showForm = () => {
    setView('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    setView('landing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCustomForm && effectiveDynamicFields.length > 0) {
      const missing = effectiveDynamicFields.find((f) => f.required && !(formValues[f.key] || '').trim());
      if (missing) {
        toast({ title: `${missing.label} is required`, variant: 'destructive' });
        return;
      }
    }
    if (!form.name.trim() || !form.phone.trim() || !form.email.trim()) {
      if (!isCustomForm || dynamicFields.length === 0) {
        toast({ title: 'Please fill all required fields', variant: 'destructive' });
        return;
      }
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if ((!isCustomForm || dynamicFields.length === 0) && !emailRegex.test(form.email.trim())) {
      toast({ title: 'Please enter a valid email', variant: 'destructive' });
      return;
    }
    if ((!isCustomForm || dynamicFields.length === 0) && !/^\d{10}$/.test(form.phone.trim())) {
      toast({ title: 'Please enter a valid 10-digit WhatsApp number', variant: 'destructive' });
      return;
    }
    const selectedSpecialization = form.specialization === 'Others'
      ? form.otherSpecialization.trim()
      : form.specialization;
    if (form.specialization === 'Others' && !selectedSpecialization) {
      toast({ title: 'Please enter your specialization', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        'https://crm.syncpedia.in/api/public-lead.php',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: isCustomForm && effectiveDynamicFields.length > 0 ? (formValues.name || formValues.full_name || '').trim() : form.name.trim(),
            email: isCustomForm && effectiveDynamicFields.length > 0 ? (formValues.email || '').trim() : form.email.trim(),
            phone: isCustomForm && effectiveDynamicFields.length > 0 ? (formValues.phone || formValues.whatsapp || '').trim() || undefined : form.phone.trim(),
            college: isCustomForm && effectiveDynamicFields.length > 0 ? (formValues.college || '').trim() || undefined : (form.college.trim() || undefined),
            year_of_study: isCustomForm && effectiveDynamicFields.length > 0 ? (formValues.year || formValues.year_of_study || '') || undefined : (form.year || undefined),
            course_interest: isCustomForm && effectiveDynamicFields.length > 0 ? (formValues.course_interest || formValues.specialization || '').trim() || undefined : (selectedSpecialization || undefined),
            notes: isCustomForm && effectiveDynamicFields.length > 0 ? JSON.stringify(formValues) : undefined,
            source: formSlug ? `form_${formSlug}` : (isNormalForm ? 'normal_form' : 'website'),
            form: formSlug || undefined,
            ref: ref || undefined,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Submission failed');
      setSubmitted(true);
    } catch (err: any) {
      console.error('Submit error:', err);
      toast({ title: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Inject page-level styles
  useEffect(() => {
    const prev = document.body.style.cssText;
    document.body.style.cssText = 'margin:0;padding:0;background:#020806;overflow-x:hidden;';
    document.documentElement.style.background = '#020806';
    return () => { document.body.style.cssText = prev; document.documentElement.style.background = ''; };
  }, []);

  useEffect(() => {
    if (!formSlug) return;
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`https://crm.syncpedia.in/api/public-lead.php?form=${encodeURIComponent(formSlug)}`);
        const data = await res.json();
        const row = data?.data;
        if (!row || !mounted) return;
        const meta = row?.meta_json || {};
        const customFields = Array.isArray(row?.fields_json) ? row.fields_json : [];
        setDynamicFields(customFields);
        const initVals: Record<string, string> = {};
        for (const f of customFields) initVals[f.key] = '';
        setFormValues(initVals);
        setFormBrand({
          companyName: String(meta?.company_name || row?.name || 'Student Survey Form'),
          logoUrl: String(meta?.logo_url || ''),
          formBg: String(meta?.form_bg || '#0A1410'),
          fieldBg: String(meta?.field_bg || '#000000'),
          textColor: String(meta?.text_color || '#ffffff'),
        });
      } catch {
        // keep defaults for branding
      }
    })();
    return () => {
      mounted = false;
    };
  }, [formSlug]);

  return (
    <>
      <style>{`
        .sp-root { --bg-deep:#020806; --bg-card:#0A1410; --accent:#2ECC71; --text-main:#fff; --text-muted:#94a3b8; --border-light:rgba(255,255,255,0.1); --glass:rgba(2,8,6,0.85); --ease-out:cubic-bezier(0.16,1,0.3,1); }
        .sp-root { box-sizing:border-box; font-family:'Inter',sans-serif; background:var(--bg-deep); color:var(--text-main); max-width:480px; margin:0 auto; min-height:100vh; min-height:100dvh; border-left:1px solid var(--border-light); border-right:1px solid var(--border-light); position:relative; box-shadow:0 0 50px rgba(0,0,0,0.5); padding-bottom:max(100px,env(safe-area-inset-bottom)); background-image:linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px); background-size:40px 40px; }
        @media(max-width:480px){.sp-root{border-left:none;border-right:none;max-width:100%;}}
        .sp-root.sp-normal{max-width:100%;border-left:none;border-right:none;box-shadow:none;padding-bottom:24px;}
        .sp-root.sp-normal .sp-press{display:none;}
        .sp-root.sp-normal .sp-header{padding:12px 0;}
        .sp-root.sp-normal .sp-logo{font-size:1rem;}
        .sp-root.sp-normal .sp-slide-right{max-width:640px;margin:0 auto;}
        .sp-form-shell{background:rgba(8,18,14,0.9);border:1px solid var(--border-light);border-radius:14px;padding:16px;}
        @media(max-width:480px){
          .sp-root.sp-normal{
            width:100vw;
            max-width:100vw;
            margin:0;
            overflow-x:hidden;
          }
          .sp-root.sp-normal .sp-content{padding:10px;}
          .sp-root.sp-normal .sp-slide-right{max-width:100%;margin:0;}
          .sp-form-shell{
            width:100%;
            padding:14px;
            border-radius:0;
            border-left:none;
            border-right:none;
            border-top:none;
            background:rgba(8,18,14,0.78);
          }
        }
        .sp-submit-wrap{margin-top:24px;}
        @media(max-width:480px){
          .sp-root.sp-normal .sp-submit-wrap{
            position:sticky;
            bottom:10px;
            z-index:30;
            margin-top:20px;
            padding-top:10px;
            background:linear-gradient(to top,rgba(2,8,6,0.95) 75%,rgba(2,8,6,0));
          }
          .sp-root.sp-normal .sp-submit-wrap .sp-btn{
            border-radius:10px;
          }
        }
        .sp-header{position:sticky;top:0;z-index:50;background:var(--glass);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border-light);padding:16px 0;text-align:center;}
        .sp-logo{height:28px;display:block;margin:0 auto;font-size:1.2rem;font-weight:800;color:var(--accent);text-decoration:none;}
        .sp-hero{position:relative;width:100%;height:280px;overflow:hidden;border-bottom:2px solid var(--accent);}
        .sp-hero img{width:100%;height:100%;object-fit:cover;filter:grayscale(0.3) contrast(1.1);}
        .sp-hero-overlay{position:absolute;inset:0;background:linear-gradient(to top,var(--bg-deep) 0%,transparent 60%);}
        .sp-badge{position:absolute;bottom:16px;left:16px;background:var(--accent);color:#000;font-weight:800;font-size:0.7rem;padding:4px 8px;text-transform:uppercase;letter-spacing:1px;}
        .sp-content{padding:24px;}
        .sp-h1{font-size:2rem;font-weight:800;line-height:1.1;margin-bottom:16px;text-transform:uppercase;}
        .sp-gradient{background:linear-gradient(to right,#fff,#999);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
        .sp-lead{font-size:1.1rem;color:var(--text-muted);line-height:1.6;font-weight:300;margin-bottom:30px;}
        .sp-meta-row{display:flex;align-items:center;gap:15px;margin-bottom:24px;flex-wrap:wrap;}
        .sp-meta-item{display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:0.5px;}
        .sp-social-card{background:rgba(255,255,255,0.03);border:1px solid var(--border-light);border-radius:16px;padding:12px 16px;display:flex;align-items:center;gap:16px;margin-bottom:30px;}
        .sp-avatar-group{display:flex;align-items:center;}
        .sp-avatar{width:38px;height:38px;border-radius:50%;border:2px solid var(--bg-deep);background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.7rem;color:#000;margin-left:-10px;}
        .sp-avatar:first-child{margin-left:0;}
        .sp-social-title{font-size:0.9rem;font-weight:700;color:#fff;margin-bottom:2px;}
        .sp-social-sub{font-size:0.75rem;color:var(--text-muted);}
        .sp-editorial{background:var(--bg-card);border-left:4px solid var(--accent);padding:20px;border-radius:0 12px 12px 0;margin-bottom:20px;}
        .sp-editorial h3{font-size:1.05rem;color:#fff;margin-bottom:8px;line-height:1.3;}
        .sp-editorial p{font-size:0.85rem;color:var(--text-muted);line-height:1.5;}
        .sp-partner-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:15px;}
        @media(max-width:360px){.sp-partner-grid{grid-template-columns:repeat(2,1fr);}}
        .sp-partner{height:40px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:#fff;border-radius:4px;border:1px solid var(--border-light);}
        .sp-blog{background:rgba(255,255,255,0.02);border:1px solid var(--border-light);padding:16px;border-radius:12px;display:flex;gap:16px;align-items:center;margin-bottom:12px;}
        .sp-blog-line{width:4px;height:36px;border-radius:10px;flex-shrink:0;}
        .sp-blog h4{font-size:0.9rem;color:#fff;font-weight:600;margin-bottom:2px;}
        .sp-blog p{font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;}
        .sp-reality{background:var(--bg-card);border:1px solid var(--border-light);padding:20px;margin:24px 0;border-radius:8px;}
        .sp-hook{font-size:0.75rem;color:var(--accent);text-transform:uppercase;letter-spacing:2px;font-weight:800;margin-bottom:16px;border-bottom:1px solid var(--border-light);padding-bottom:8px;display:inline-block;}
        .sp-reality-item{display:flex;gap:12px;margin-bottom:16px;}
        .sp-reality-item:last-child{margin-bottom:0;}
        .sp-icon-box{width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0;}
        .sp-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:24px;}
        .sp-stat{background:var(--bg-card);border:1px solid var(--border-light);padding:16px;text-align:center;}
        .sp-stat-val{display:block;font-size:1.5rem;font-weight:700;color:#fff;}
        .sp-stat-lbl{font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;}
        .sp-roadmap{margin-top:30px;padding-left:10px;}
        .sp-step{position:relative;padding-left:30px;padding-bottom:30px;border-left:1px solid var(--border-light);}
        .sp-step:last-child{border-left:none;padding-bottom:0;}
        .sp-step::before{content:'';position:absolute;left:-5px;top:0;width:9px;height:9px;background:var(--accent);border-radius:50%;box-shadow:0 0 10px var(--accent);}
        .sp-step h4{font-size:1rem;color:#fff;font-weight:700;}
        .sp-step p{font-size:0.85rem;color:var(--text-muted);margin-top:4px;}
        .sp-iso{background:var(--bg-card);border:1px solid var(--border-light);padding:20px;border-radius:12px;display:flex;align-items:center;gap:16px;margin-top:24px;}
        .sp-iso-badge{background:var(--accent);color:#000;font-weight:800;font-size:0.65rem;padding:8px 12px;text-transform:uppercase;letter-spacing:1px;}
        .sp-iso-text h4{font-size:0.9rem;color:#fff;font-weight:700;}
        .sp-iso-text p{font-size:0.8rem;color:var(--text-muted);margin-top:2px;}
        .sp-footer-bar{position:fixed;bottom:0;left:0;right:0;z-index:100;background:var(--glass);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--border-light);padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));display:flex;justify-content:center;}
        .sp-footer-inner{width:100%;max-width:480px;margin:0 auto;}
        .sp-btn{display:block;width:100%;background:var(--accent);color:#000;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:16px;min-height:48px;border:none;cursor:pointer;font-size:1rem;text-align:center;box-shadow:0 0 20px rgba(46,204,113,0.2);transition:transform 0.2s,box-shadow 0.2s;-webkit-tap-highlight-color:transparent;}
        .sp-btn:active{transform:scale(0.98);}
        .sp-btn:hover{box-shadow:0 0 30px rgba(46,204,113,0.4);}
        .sp-btn:disabled{opacity:0.6;cursor:not-allowed;}
        .sp-press{background:#050c09;padding:12px 0;border-bottom:1px solid var(--border-light);overflow:hidden;}
        .sp-press-inner{display:flex;justify-content:space-around;align-items:center;opacity:0.5;}
        .sp-press-item{font-weight:800;font-size:0.75rem;color:#fff;text-transform:uppercase;letter-spacing:1px;}
        .sp-back{background:none;border:none;color:var(--text-muted);font-size:0.85rem;font-weight:700;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;gap:8px;margin-bottom:24px;padding:0;}
        .sp-back:hover{color:#fff;}
        .sp-form-group{margin-bottom:20px;}
        .sp-label{display:block;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;}
        .sp-root.sp-custom .sp-label{font-size:0.8rem;color:var(--text-main);font-weight:800;}
        .sp-input{width:100%;background:var(--field-bg,#000);border:1px solid var(--border-light);color:var(--text-main,#fff);padding:16px;min-height:48px;font-size:16px;font-family:'Inter',sans-serif;border-radius:0;transition:border-color 0.3s;-webkit-appearance:none;}
        .sp-input:focus{outline:none;border-color:var(--accent);}
        @media(max-width:480px){.sp-input{min-height:50px;border-radius:10px;padding:14px;}}
        .sp-input::placeholder{color:rgba(255,255,255,0.3);}
        select.sp-input{appearance:none;background-image:url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%232ECC71%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");background-repeat:no-repeat;background-position:right 16px top 50%;background-size:10px;}
        .sp-secure{display:flex;gap:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border-light);padding:12px;margin-top:24px;align-items:center;}
        .sp-secure-text{font-size:0.75rem;color:var(--text-muted);}
        .sp-success{text-align:center;padding:60px 24px;}
        .sp-success h2{font-size:1.5rem;font-weight:800;color:var(--accent);margin-bottom:8px;}
        .sp-success p{font-size:0.95rem;color:var(--text-muted);}
        .sp-slide-right{animation:spSlideRight 0.4s cubic-bezier(0.16,1,0.3,1) forwards;}
        .sp-slide-left{animation:spSlideLeft 0.4s cubic-bezier(0.16,1,0.3,1) forwards;}
        @keyframes spSlideRight{from{transform:translateX(20px);opacity:0;}to{transform:translateX(0);opacity:1;}}
        @keyframes spSlideLeft{from{transform:translateX(-20px);opacity:0;}to{transform:translateX(0);opacity:1;}}
      `}</style>

      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      <div
        className={`sp-root ${isNormalForm ? 'sp-normal' : ''} ${isCustomForm ? 'sp-custom' : ''}`}
        style={{
          ['--bg-card' as any]: formBrand.formBg,
          ['--text-main' as any]: formBrand.textColor,
          ['--text-muted' as any]: formBrand.textColor,
          ['--field-bg' as any]: formBrand.fieldBg,
        }}
      >
        {/* Header */}
        <header className="sp-header">
          {formBrand.logoUrl ? (
            <img src={formBrand.logoUrl} alt={formBrand.companyName} className="sp-logo" style={{ height: 30, objectFit: 'contain' }} />
          ) : null}
          <span className="sp-logo" style={{ marginTop: formBrand.logoUrl ? 8 : 0 }}>{formBrand.companyName || 'Student Survey Form'}</span>
        </header>

        {/* Press Strip (keep for built-in forms only) */}
        {!isCustomForm && (
          <div className="sp-press">
            <div className="sp-press-inner">
              <span className="sp-press-item">NDTV Education</span>
              <span className="sp-press-item">Hans India</span>
              <span className="sp-press-item">YourStory</span>
            </div>
          </div>
        )}

        {/* LANDING VIEW */}
        {!isNormalForm && view === 'landing' && !submitted && (
          <div className="sp-slide-left">
            {/* Hero Banner */}
            <div className="sp-hero">
              <img src="https://syncpedia.in/syncpedia/hero_img.png" alt="Syncpedia Internship" />
              <div className="sp-hero-overlay" />
              <div className="sp-badge">Batch Closing Soon</div>
            </div>

            <div className="sp-content">
              <h1 className="sp-h1">
                <span className="sp-gradient">Bridge The Gap Between Degree & Industry</span>
              </h1>
              <p className="sp-lead">
                Colleges teach syntax. We teach survival. Join the ISO-certified internship program trusted by top companies.
              </p>

              {/* Meta row */}
              <div className="sp-meta-row">
                <span className="sp-meta-item">
                  <svg className="sp-meta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                  Month 1: Training
                </span>
                <span className="sp-meta-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Month 2: Projects
                </span>
                <span className="sp-meta-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  Month 3: Career Dev
                </span>
              </div>

              {/* Social Proof */}
              <div className="sp-social-card">
                <div className="sp-avatar-group">
                  <div className="sp-avatar">A</div>
                  <div className="sp-avatar">R</div>
                  <div className="sp-avatar">S</div>
                  <div className="sp-avatar">P</div>
                </div>
                <div>
                  <div className="sp-social-title">18,500+ Engineering Students</div>
                  <div className="sp-social-sub">have transitioned to high-growth careers.</div>
                </div>
              </div>

              {/* Editorial */}
              <div className="sp-editorial">
                <h3>"Why Skills Outperform Degrees in 2026"</h3>
                <p>A recent study reveals that 84% of tech recruiters prioritize ISO-certified production experience over college GPA. Syncpedia's model bridges this exact gap.</p>
              </div>

              {/* Placement Ecosystem */}
              <div style={{ marginTop: 24 }}>
                <div className="sp-hook">Placement Ecosystem</div>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: 12 }}>Alumni working at projects associated with:</p>
                <div className="sp-partner-grid">
                  {['TCS', 'Wipro', 'Accenture', 'Infosys', 'Cognizant', 'Capgemini'].map(c => (
                    <div key={c} className="sp-partner">{c}</div>
                  ))}
                </div>
              </div>

              {/* Blog Cards */}
              <div style={{ marginTop: 30 }}>
                <div className="sp-hook">Education Insights & Blogs</div>
                {[
                  { title: 'The ROI of Industrial Internships', sub: 'Published in EduTech Weekly • Feb 2026', color: '#2ECC71' },
                  { title: 'Bridging the Skill Gap in Tier-2 Cities', sub: 'Career Trends by Startup India', color: '#3498db' },
                  { title: 'Future of AI & VLSI Engineering', sub: 'Tech Journal Hyderabad Edition', color: '#e74c3c' },
                ].map((b, i) => (
                  <div key={i} className="sp-blog">
                    <div className="sp-blog-line" style={{ background: b.color }} />
                    <div>
                      <h4>{b.title}</h4>
                      <p>{b.sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reality Check */}
              <div className="sp-reality">
                <div className="sp-hook">The Industry Reality</div>
                <div className="sp-reality-item">
                  <div className="sp-icon-box" style={{ color: '#ff4d4d' }}>✕</div>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', marginBottom: 2 }}>Academic Projects Don't Count</h3>
                    <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.4 }}>Recruiters ignore library management systems. They want scalable, deployed apps.</p>
                  </div>
                </div>
                <div className="sp-reality-item">
                  <div className="sp-icon-box" style={{ color: '#2ECC71', background: 'rgba(46,204,113,0.1)', borderRadius: '50%' }}>✓</div>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', marginBottom: 2 }}>Production Experience Wins</h3>
                    <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.4 }}>Our interns push code to production using CI/CD pipelines.</p>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="sp-stats">
                <div className="sp-stat">
                  <span className="sp-stat-val">100%</span>
                  <span className="sp-stat-lbl">Live Projects</span>
                </div>
                <div className="sp-stat">
                  <span className="sp-stat-val">ISO</span>
                  <span className="sp-stat-lbl">9001:2015 Cert.</span>
                </div>
              </div>

              {/* Roadmap */}
              <div style={{ marginTop: 30 }}>
                <div className="sp-hook">Internship Roadmap</div>
                <div className="sp-roadmap">
                  <div className="sp-step">
                    <h4>Month 1: Training</h4>
                    <p>Git workflows, corporate standards, and deep technical foundations.</p>
                  </div>
                  <div className="sp-step">
                    <h4>Month 2: Live Build</h4>
                    <p>Building complex modules and debugging real-world production issues.</p>
                  </div>
                  <div className="sp-step">
                    <h4>Month 3: Portfolio</h4>
                    <p>Cloud deployment, interview prep, and global certification.</p>
                  </div>
                </div>
              </div>

              {/* ISO Card */}
              <div className="sp-iso">
                <div>
                  <div className="sp-hook" style={{ marginBottom: 4, borderBottom: 'none', paddingBottom: 0 }}>Verified Proof</div>
                  <div className="sp-iso-text">
                    <h4>ISO 9001:2015 Certified</h4>
                    <p>Every intern receives a unique QR-code verified certificate acceptable in MNCs.</p>
                  </div>
                </div>
                <div className="sp-iso-badge">VERIFIED</div>
              </div>
            </div>
          </div>
        )}

        {/* FORM VIEW */}
        {view === 'form' && !submitted && (
          <div className="sp-slide-right">
            <div className="sp-content">
              {!isCustomForm && !isBuiltinFormSlug && (
                <button type="button" className="sp-back" onClick={goBack}>
                  ← Back to Details
                </button>
              )}
              <div className="sp-form-shell">
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 4, color: isCustomForm ? formBrand.textColor : undefined }}>Application</h2>
                  <p style={{ fontSize: '0.85rem', color: isCustomForm ? formBrand.textColor : '#94a3b8', fontWeight: isCustomForm ? 600 : 400 }}>Fill in your details to begin the screening process.</p>
                </div>

                <form onSubmit={handleSubmit}>
                {isCustomForm && effectiveDynamicFields.length > 0 ? (
                  <>
                    {effectiveDynamicFields.map((field) => (
                      <div className="sp-form-group" key={field.id || field.key}>
                        <label className="sp-label">{field.label}</label>
                        {field.type === 'textarea' ? (
                          <textarea
                            className="sp-input"
                            placeholder={field.placeholder || ''}
                            value={formValues[field.key] || ''}
                            onChange={(e) => handleDynamicFieldChange(field.key, e.target.value)}
                            required={!!field.required}
                          />
                        ) : field.type === 'select' ? (
                          <select
                            className="sp-input"
                            value={formValues[field.key] || ''}
                            onChange={(e) => handleDynamicFieldChange(field.key, e.target.value)}
                            required={!!field.required}
                          >
                            <option value="">{field.placeholder || `Select ${field.label}`}</option>
                            {(field.options || []).map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="sp-input"
                            type={field.type === 'phone' ? 'tel' : field.type}
                            placeholder={field.placeholder || ''}
                            value={formValues[field.key] || ''}
                            onChange={(e) => handleDynamicFieldChange(field.key, e.target.value)}
                            required={!!field.required}
                          />
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                <div className="sp-form-group">
                  <label className="sp-label">Full Name</label>
                  <input className="sp-input" type="text" placeholder="Your full name" maxLength={100} value={form.name} onChange={e => handleChange('name', e.target.value)} required />
                </div>

                <div className="sp-form-group">
                  <label className="sp-label">WhatsApp Number</label>
                  <input
                    className="sp-input"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    placeholder=""
                    maxLength={10}
                    value={form.phone}
                    onChange={e => handlePhoneChange(e.target.value)}
                    required
                  />
                </div>

                <div className="sp-form-group">
                  <label className="sp-label">Email Address</label>
                  <input className="sp-input" type="email" placeholder="you@domain.com" maxLength={255} value={form.email} onChange={e => handleChange('email', e.target.value)} required />
                </div>

                <div className="sp-form-group">
                  <label className="sp-label">Select Specialization</label>
                  <select className="sp-input" value={form.specialization} onChange={e => handleChange('specialization', e.target.value)}>
                    <option value="">Choose your domain</option>
                    {SPECIALIZATIONS.map(group => (
                      <optgroup key={group.group} label={group.group}>
                        {group.options.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="Others">Others</option>
                  </select>
                </div>

                {form.specialization === 'Others' && (
                  <div className="sp-form-group">
                    <label className="sp-label">Please Specify</label>
                    <input
                      className="sp-input"
                      type="text"
                      placeholder="Type your specialization"
                      maxLength={120}
                      value={form.otherSpecialization}
                      onChange={e => handleChange('otherSpecialization', e.target.value)}
                      required
                    />
                  </div>
                )}

                <div className="sp-form-group">
                  <label className="sp-label">College Name</label>
                  <input className="sp-input" type="text" placeholder="Your college / university" maxLength={200} value={form.college} onChange={e => handleChange('college', e.target.value)} />
                </div>

                <div className="sp-form-group">
                  <label className="sp-label">Year of Study</label>
                  <select className="sp-input" value={form.year} onChange={e => handleChange('year', e.target.value)}>
                    <option value="">Select year</option>
                    <option value="1st Year">1st Year</option>
                    <option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option>
                    <option value="4th Year">4th Year</option>
                    <option value="Graduated">Graduated</option>
                    <option value="Working Professional">Working Professional</option>
                  </select>
                </div>
                </>
                )}

                <div className="sp-secure">
                  <span style={{ color: '#2ECC71', fontSize: '1rem' }}>🔒</span>
                  <span className="sp-secure-text">Your data is ISO-protected and never shared with third parties.</span>
                </div>

                <div className="sp-submit-wrap">
                  <button type="submit" className="sp-btn" disabled={loading}>
                    {loading ? 'Submitting...' : 'Submit Application'}
                  </button>
                </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* SUCCESS STATE */}
        {submitted && (
          <div className="sp-success">
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>✓</div>
            <h2>Applied!</h2>
            <p>Our counselor will call you within 24 hours.</p>
          </div>
        )}

        {/* Sticky Footer CTA (landing only) */}
        {!isNormalForm && view === 'landing' && !submitted && (
          <div className="sp-footer-bar">
            <div className="sp-footer-inner">
              <button className="sp-btn" onClick={showForm}>Apply Now</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
