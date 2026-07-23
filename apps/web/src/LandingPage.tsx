import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles, ArrowRight, Check, Plus, ShieldCheck, Lock, UserCheck, FileText, Zap, Clock,
  Compass, Utensils, Stethoscope, Scissors, GraduationCap, ShoppingBag, Briefcase, Loader,
  Car, Home, BarChart3, ChevronRight,
} from 'lucide-react';
import { joinWaitlist } from './lib/api';
import { PrivacyPolicy, TermsOfService } from './LegalContent';

interface LandingPageProps {
  onLaunchApp: () => void;
  onStartOnboarding: () => void;
}

/* ── Palette (elevated from the app's dark + cyan identity, WhatsApp-green as the "live" signal) ── */
const C = {
  bg: '#070a0f',
  raised: '#0a0e15',
  card: '#0e1420',
  line: 'rgba(255,255,255,0.08)',
  lineSoft: 'rgba(255,255,255,0.05)',
  cyan: '#00e5ff',
  cyan2: '#4facfe',
  green: '#25d366',
  greenDeep: '#00a884',
  text: '#eef2f7',
  muted: '#94a3b8',
  faint: '#5f6d7e',
};
const MAXW = 1160;

/* ─── Scroll reveal ──────────────────────────────────────────────────── */
function Reveal({ children, style, delay = 0, className = '' }: { children: React.ReactNode; style?: React.CSSProperties; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`lp-reveal ${seen ? 'lp-in' : ''} ${className}`} style={{ animationDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}

/* ─── Section scaffold ───────────────────────────────────────────────── */
function Eyebrow({ children, color = C.cyan }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontSize: '12px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '14px', fontFamily: 'monospace' }}>
      {children}
    </div>
  );
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="lp-h2" style={{ fontSize: '40px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', letterSpacing: '-1px', lineHeight: 1.12 }}>{children}</h2>;
}

/* ─── WhatsApp thread mock (hero + demo) ─────────────────────────────── */
type Msg =
  | { k: 'sys'; t: string }
  | { k: 'in' | 'out'; t: React.ReactNode; time: string }
  | { k: 'pay'; who: string; sub: string; amt: string };

const HERO_THREAD: Msg[] = [
  { k: 'sys', t: '🔒 Handled by an AI teammate · a human can step in anytime' },
  { k: 'in', t: 'Namaste Aarav! 🌏 I saw you were looking at our Bali getaways — want me to plan the perfect trip for you?', time: '11:04' },
  { k: 'out', t: 'Yes! Mid-October, 2 of us, ~₹1L each 🏝️', time: '11:05' },
  { k: 'in', t: <>Perfect — our <b>Bali Beach Escape</b> (5N/6D) is ₹49,999/person: private-pool villa, daily breakfast, a sunset dinner cruise &amp; a Nusa Penida tour. Shall I hold it?</>, time: '11:06' },
  { k: 'out', t: 'Yes please 😍', time: '11:07' },
  { k: 'pay', who: 'Sunroute Travel', sub: 'Bali Beach Escape · 2 travellers', amt: '₹99,998' },
  { k: 'out', t: 'Paid ✅', time: '11:09' },
  { k: 'in', t: <>🎉 Booking <b>BK-48213</b> confirmed! Your itinerary &amp; villa voucher are on the way.</>, time: '11:09' },
];

function PhoneThread({ msgs, title = 'Sunroute Travel', maxHeight }: { msgs: Msg[]; title?: string; maxHeight?: number }) {
  return (
    <div style={{ width: '340px', maxWidth: '100%', backgroundColor: '#0b141a', borderRadius: '28px', border: `1px solid ${C.line}`, boxShadow: '0 30px 70px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
      <div style={{ backgroundColor: '#1f2c34', display: 'flex', alignItems: 'center', gap: '10px', padding: '13px 15px' }}>
        <span style={{ color: '#8696a0', fontSize: '18px' }}>‹</span>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: `linear-gradient(135deg, ${C.cyan}, ${C.cyan2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🧭</div>
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ color: '#e9edef', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '5px' }}>{title} <span style={{ color: '#53bdeb', fontSize: '11px' }}>✔</span></div>
          <div style={{ color: C.green, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', background: C.green }} /> online · replies instantly</div>
        </div>
      </div>
      <div style={{ padding: '16px 12px', maxHeight: maxHeight ? `${maxHeight}px` : undefined, overflowY: maxHeight ? 'auto' : undefined, display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#0b141a', backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {msgs.map((m, i) => {
          if (m.k === 'sys') return <div key={i} style={{ alignSelf: 'center', textAlign: 'center', maxWidth: '88%', background: 'rgba(31,44,52,0.7)', color: '#8696a0', fontSize: '11px', padding: '6px 12px', borderRadius: '9px', lineHeight: 1.4 }}>{m.t}</div>;
          if (m.k === 'pay') return (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '90%', backgroundColor: '#1f2c34', borderRadius: '11px 11px 11px 3px', padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ width: '34px', height: '34px', borderRadius: '8px', background: `linear-gradient(135deg, ${C.cyan}, ${C.cyan2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🧭</span>
                <span><div style={{ color: '#e9edef', fontSize: '13px', fontWeight: 700 }}>{m.who}</div><div style={{ color: '#8696a0', fontSize: '11px' }}>{m.sub}</div></span>
                <span style={{ marginLeft: 'auto', color: '#e9edef', fontWeight: 700, fontSize: '14px' }}>{m.amt}</span>
              </div>
              <button style={{ marginTop: '11px', background: C.greenDeep, color: '#04231c', border: 'none', width: '100%', padding: '10px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>🔒 Pay securely · Razorpay</button>
            </div>
          );
          const out = m.k === 'out';
          return (
            <div key={i} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: out ? '#005c4b' : '#1f2c34', color: '#e9edef', padding: '7px 10px 6px', borderRadius: out ? '11px 11px 3px 11px' : '11px 11px 11px 3px', fontSize: '13.5px', lineHeight: 1.42 }}>
              {m.t}
              <span style={{ display: 'block', textAlign: 'right', color: '#8696a0', fontSize: '10px', marginTop: '3px' }}>
                {!out && <span style={{ color: C.cyan, fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.04em', marginRight: '5px' }}>AI</span>}
                {m.time}{out && <span style={{ color: '#53bdeb' }}> ✓✓</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px 12px', backgroundColor: '#0b141a' }}>
        <span style={{ flex: 1, backgroundColor: '#1f2c34', borderRadius: '20px', padding: '9px 14px', color: '#8696a0', fontSize: '13px' }}>Message</span>
        <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: C.greenDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>🎤</span>
      </div>
    </div>
  );
}

/* ─── Content ────────────────────────────────────────────────────────── */
const AI_TEAM = [
  { avatar: '💼', name: 'Sales', color: C.cyan, tagline: 'Turns curious visitors into paying customers.', tasks: ['Qualifies every lead instantly', 'Recommends the right package', 'Generates quotes on the spot'] },
  { avatar: '🎧', name: 'Support', color: C.green, tagline: 'Answers in seconds, escalates when it matters.', tasks: ['Answers from your own policies', 'Resolves issues 24×7', 'Hands off to a human when needed'] },
  { avatar: '📅', name: 'Booking', color: C.cyan2, tagline: 'Fills your calendar without the back-and-forth.', tasks: ['Schedules appointments & slots', 'Confirms and sends reminders', 'Zero double-bookings'] },
  { avatar: '💳', name: 'Finance', color: '#feb47b', tagline: 'Gets you paid, on time, every time.', tasks: ['Sends secure payment links', 'Issues invoices & receipts', 'Chases pending payments politely'] },
];

const VERTICALS = [
  { icon: <Compass size={22} />, name: 'Travel' },
  { icon: <Scissors size={22} />, name: 'Salon' },
  { icon: <Stethoscope size={22} />, name: 'Clinic' },
  { icon: <Utensils size={22} />, name: 'Restaurant' },
  { icon: <GraduationCap size={22} />, name: 'Education' },
  { icon: <ShoppingBag size={22} />, name: 'Retail' },
  { icon: <Briefcase size={22} />, name: 'Services' },
  { icon: <Car size={22} />, name: 'Cab & travel' },
  { icon: <Home size={22} />, name: 'Home services' },
];

const SECURITY = [
  { icon: <Lock size={20} />, title: 'Encrypted at rest', body: 'Access tokens and secrets are sealed with AES-256-GCM. Customer data sits behind row-level security, isolated per business.' },
  { icon: <UserCheck size={20} />, title: 'Consent-first messaging', body: 'Every contact carries an opt-in state. Follow-ups respect consent and only send inside the 09:00–21:00 window.' },
  { icon: <ShieldCheck size={20} />, title: 'Human in the loop', body: 'Safety gates block risky claims and hand off to a real person the moment a conversation needs one.' },
  { icon: <FileText size={20} />, title: 'Your data, portable', body: 'One-tap export and full erasure for any customer — built for GDPR-style data requests from day one.' },
  { icon: <ShieldCheck size={20} />, title: 'Meta Business Platform', body: 'Runs on the official WhatsApp Business Platform with verified webhooks — no unofficial workarounds.' },
  { icon: <Zap size={20} />, title: 'Grounded answers', body: 'Replies are grounded in your own catalogue and policies via retrieval — no invented prices, no made-up products.' },
];

const PRICING = [
  { id: 'starter', name: 'Starter', price: '₹999', tagline: 'For solo owners getting started.', highlight: false, features: ['1 WhatsApp number', 'AI Sales + Support', 'Lead capture & CRM', 'Up to 500 conversations / mo', 'Email support'] },
  { id: 'growth', name: 'Growth', price: '₹2,999', tagline: 'For growing teams that sell daily.', highlight: true, features: ['Everything in Starter', 'AI Booking + Payments', 'Quotes, invoices & Razorpay links', 'Up to 3,000 conversations / mo', 'Analytics & team inbox', 'Priority support'] },
  { id: 'scale', name: 'Scale', price: '₹7,999', tagline: 'For high-volume operations.', highlight: false, features: ['Everything in Growth', 'HubSpot two-way sync', 'Instagram & Messenger channels', 'Unlimited conversations', 'Custom knowledge base', 'Dedicated onboarding'] },
];

const WHY_DIFFERENT = [
  ['Another AI chatbot', 'An AI teammate that finishes the job'],
  ['Answers questions', 'Completes tasks — quote, book, charge'],
  ['Five disconnected tools', 'One platform, one conversation'],
  ['You update everything by hand', 'Workflows run automatically'],
  ['Dashboard you must log into', 'Lives where your customers already are'],
];

const GROWTH_SERVICES = [
  {
    id: 'smm',
    num: '01 / 06',
    title: 'Social Media Marketing',
    badgeText: 'GROWTH SERVICE: SMM',
    description: 'Elevate your brand presence across Instagram, Facebook, and LinkedIn with automated content calendars and targeted viral campaigns.',
    highlights: ['Content strategy & viral creation', 'Audience engagement & growth', 'Social ad campaign management'],
    btnText: 'Explore SMM',
    color: '#00F2FE',
    accent: '#00FF87',
  },
  {
    id: 'seo',
    num: '02 / 06',
    title: 'Search Engine Optimization',
    badgeText: 'GROWTH SERVICE: Organic SEO',
    description: 'Boost your website domain authority and rank #1 for high-value search queries with our comprehensive organic search optimization.',
    highlights: ['Keyword research & ranking', 'Technical site speed audit', 'On-page & off-page optimization'],
    btnText: 'Explore SEO',
    color: '#7CF9FF',
    accent: '#2B6CFF',
  },
  {
    id: 'local_seo',
    num: '03 / 06',
    title: 'Local Business SEO',
    badgeText: 'GROWTH SERVICE: Local Business SEO',
    description: 'Dominate your local market and ensure customers find you first with our specialized Local SEO strategies. We help your business rise to the top of local search results, connecting you with customers who are actively looking for your products or services in your area.',
    highlights: ['Hyper-local keyword targeting', 'Citation building & NAP consistency', 'High-quality local backlinks'],
    btnText: 'Explore Local',
    color: '#20B2AA',
    accent: '#00FF87',
    stats: { impressions: '17.6K', ctr: '1.3%', position: '25.2' },
  },
  {
    id: 'seo_marketing',
    num: '04 / 06',
    title: 'SEO Marketing',
    badgeText: 'GROWTH SERVICE: SEO Marketing',
    description: 'Achieve sustainable long-term growth and maximize your organic visibility with our comprehensive SEO marketing solutions. We go beyond basic keywords to implement a data-driven strategy that aligns with your business goals.',
    highlights: ['Data-driven content marketing', 'Authoritative link-building', 'Technical SEO audits'],
    btnText: 'Explore SEO',
    color: '#FFA500',
    accent: '#FF8C00',
  },
  {
    id: 'lead_gen',
    num: '05 / 06',
    title: 'Lead Generation',
    badgeText: 'GROWTH SERVICE: Lead Generation',
    description: 'Fuel your sales pipeline with high-quality, conversion-ready prospects through our targeted Lead Generation services. We move beyond vanity metrics to deliver leads that actually impact your bottom line.',
    highlights: ['Targeted paid ads & funnels', 'B2B and B2C lead nurturing', 'Lower CAC, higher conversion'],
    btnText: 'Explore Lead',
    color: '#FF4500',
    accent: '#FFD700',
  },
  {
    id: 'chat_automation',
    num: '06 / 06',
    title: 'Chat Automation',
    badgeText: 'GROWTH SERVICE: Chat Automation',
    description: 'Transform your customer support and engagement with our intelligent Chat Automation solutions. We deploy advanced chatbots on popular platforms like WhatsApp, Facebook Messenger, and your website to provide instant, 24/7 assistance.',
    highlights: ['WhatsApp + Messenger + website bots', '24/7 automated replies & booking', 'Free your team for complex queries'],
    btnText: 'Explore Chat',
    color: '#00E5FF',
    accent: '#25D366',
  },
];

const FAQ = [
  { q: 'Do my customers need to install anything?', a: 'No. Everything happens inside WhatsApp — the app your customers already use every day. There is nothing new for them to download or learn.' },
  { q: 'How long does it take to go live?', a: 'Most businesses are live in about five minutes. Connect your WhatsApp Business number, pick your vertical template, and your AI teammate starts replying.' },
  { q: 'Will it make up answers or wrong prices?', a: 'No. Answers are grounded in your own catalogue and policies through retrieval, and safety gates block unsupported claims. When it is unsure, it hands off to you.' },
  { q: 'Can a human take over a conversation?', a: 'Any time. Your team sees every thread in a shared inbox and can claim a conversation with one tap — the AI steps aside instantly.' },
  { q: 'Is my business and customer data safe?', a: 'Secrets are encrypted at rest, data is isolated per business with row-level security, and every customer can be exported or erased on request.' },
  { q: 'Which payment methods are supported?', a: 'Secure payment links via Razorpay — UPI, cards and net-banking. Bookings flip to confirmed automatically the instant payment is verified.' },
];

/* ─── Landing page ───────────────────────────────────────────────────── */
export function LandingPage({ onLaunchApp }: LandingPageProps) {
  const [wlEmail, setWlEmail] = useState('');
  const [wlType, setWlType] = useState('');
  const [wlState, setWlState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [wlError, setWlError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [legal, setLegal] = useState<null | 'privacy' | 'terms'>(null);
  const [activeGrowthSlide, setActiveGrowthSlide] = useState(2); // default to 03 / 06 Local Business SEO
  const [modalGrowthService, setModalGrowthService] = useState<typeof GROWTH_SERVICES[0] | null>(null);

  const openLegal = (page: 'privacy' | 'terms') => {
    setLegal(page);
    window.scrollTo({ top: 0 });
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  const submitWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (wlState === 'submitting') return;
    setWlState('submitting'); setWlError(null);
    const err = await joinWaitlist(wlEmail, wlType || null);
    if (err) { setWlError(err); setWlState('error'); } else setWlState('done');
  };

  const linkStyle: React.CSSProperties = { color: C.muted, textDecoration: 'none', transition: 'color 0.2s', cursor: 'pointer', fontSize: '14px', fontWeight: 500 };
  const hoverIn = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.color = C.text);
  const hoverOut = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.color = C.muted);
  const primaryBtn: React.CSSProperties = { padding: '14px 26px', borderRadius: '12px', background: `linear-gradient(135deg, ${C.cyan}, ${C.cyan2})`, color: '#00232b', border: 'none', fontWeight: 800, fontSize: '15px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '9px', boxShadow: '0 8px 30px rgba(0,229,255,0.25)' };
  const ghostBtn: React.CSSProperties = { padding: '14px 24px', borderRadius: '12px', backgroundColor: 'transparent', color: C.text, border: `1px solid ${C.lineSoft}`, fontWeight: 600, fontSize: '15px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '9px' };
  const sectionPad: React.CSSProperties = { maxWidth: `${MAXW}px`, margin: '0 auto', padding: '96px 32px' };

  if (legal === 'privacy') return <PrivacyPolicy onBack={() => setLegal(null)} />;
  if (legal === 'terms') return <TermsOfService onBack={() => setLegal(null)} />;

  return (
    <div style={{ backgroundColor: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, sans-serif', overflowX: 'hidden' }}>

      {/* ─── Nav ─── */}
      <nav className="lp-nav" style={{ position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(16px)', backgroundColor: 'rgba(7,10,15,0.82)', borderBottom: `1px solid ${C.line}`, padding: '15px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', cursor: 'pointer' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <img src="/saarthione-peacock-feather-v2.png" alt="SaarthiOne" width={32} height={32} style={{ borderRadius: '9px' }} />
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '21px', letterSpacing: '-0.5px' }}>Saarthi<span style={{ color: C.cyan }}>One</span></span>
        </div>
        <div className="lp-nav-links">
          <a style={linkStyle} onClick={() => scrollTo('team')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>Product</a>
          <a style={linkStyle} onClick={() => scrollTo('how')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>How it works</a>
          <a style={linkStyle} onClick={() => scrollTo('security')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>Security</a>
          <a style={linkStyle} onClick={() => scrollTo('pricing')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>Pricing</a>
          <a style={linkStyle} onClick={() => scrollTo('faq')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>FAQ</a>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button className="lp-nav-signin" onClick={onLaunchApp} style={{ padding: '9px 16px', borderRadius: '10px', backgroundColor: 'transparent', color: C.text, border: `1px solid ${C.lineSoft}`, fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>Sign in</button>
          <button onClick={onLaunchApp} style={{ ...primaryBtn, padding: '9px 18px', fontSize: '13px', boxShadow: 'none' }}>Get started</button>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="lp-section" style={{ ...sectionPad, paddingTop: '72px', paddingBottom: '48px', display: 'grid', alignItems: 'center', gap: '56px' }}>
        <div className="lp-hero" style={{ display: 'grid', alignItems: 'center', gap: '56px' }}>
          <Reveal>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 13px', borderRadius: '20px', backgroundColor: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', color: C.green, fontSize: '12px', fontWeight: 600, marginBottom: '22px' }}>
              <Sparkles size={14} /> Live on the WhatsApp Business Platform
            </div>
            <h1 className="lp-h1" style={{ fontSize: '56px', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-1.8px', marginBottom: '20px', fontFamily: 'Outfit, sans-serif' }}>
              An AI teammate that runs your business on WhatsApp.
            </h1>
            <p style={{ fontSize: '18px', color: C.muted, lineHeight: 1.62, marginBottom: '30px', maxWidth: '500px' }}>
              SaarthiOne turns every customer chat into qualified leads, quotes, bookings and payments — automatically. No new app for your customers, no five tools to juggle.
            </p>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '26px', flexWrap: 'wrap' }}>
              <button onClick={onLaunchApp} style={primaryBtn}>Get started free <ArrowRight size={18} /></button>
              <button onClick={() => scrollTo('how')} style={ghostBtn}>See how it works</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', color: C.faint, fontSize: '13px', flexWrap: 'wrap' }}>
              {['Live in 5 minutes', 'No code', 'Cancel anytime'].map((t) => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Check size={15} style={{ color: C.green }} /> {t}</span>
              ))}
            </div>
          </Reveal>
          <Reveal className="lp-hero-visual" delay={120} style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: '-40px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,229,255,0.12) 0%, transparent 68%)', filter: 'blur(30px)' }} />
            <div style={{ position: 'relative' }}><PhoneThread msgs={HERO_THREAD} maxHeight={430} /></div>
          </Reveal>
        </div>
      </section>

      {/* ─── Trust strip ─── */}
      <section style={{ borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, backgroundColor: C.raised }}>
        <div style={{ maxWidth: `${MAXW}px`, margin: '0 auto', padding: '26px 32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '38px', flexWrap: 'wrap', color: C.faint, fontSize: '13.5px', fontWeight: 600 }}>
          <span style={{ letterSpacing: '0.5px' }}>Built on</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.muted }}>🟢 WhatsApp Business</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.muted }}>◆ Meta Cloud API</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.muted }}>💳 Razorpay</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.muted }}>🔗 HubSpot</span>
        </div>
      </section>

      {/* ─── Problem → Solution ─── */}
      <section id="problem" className="lp-section" style={sectionPad}>
        <Reveal style={{ textAlign: 'center', marginBottom: '48px' }}>
          <Eyebrow color="#ff8f8f">The problem</Eyebrow>
          <H2>Running a business shouldn’t mean juggling five tools.</H2>
        </Reveal>
        <Reveal className="lp-smb" style={{ display: 'grid', gap: '22px', alignItems: 'stretch' }}>
          <div className="lp-card" style={{ backgroundColor: C.card, borderRadius: '20px', padding: '28px', border: '1px solid rgba(255,107,107,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#ffb4b4', marginBottom: '18px' }}>Today, without SaarthiOne</div>
            {['Reply on WhatsApp', 'Copy details into a CRM', 'Open the booking tool', 'Create a payment link', 'Remember to follow up'].map((t, i) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.lineSoft}`, color: C.muted, fontSize: '14.5px' }}>
                <span style={{ width: '22px', height: '22px', borderRadius: '6px', background: 'rgba(255,107,107,0.12)', color: '#ff8f8f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                {t}
              </div>
            ))}
            <div style={{ marginTop: '16px', color: '#ff8f8f', fontSize: '13px', fontWeight: 600 }}>Everything is manual. Something always slips.</div>
          </div>
          <div className="lp-card" style={{ backgroundColor: '#0c1420', borderRadius: '20px', padding: '28px', border: '1px solid rgba(0,229,255,0.3)', boxShadow: '0 0 40px rgba(0,229,255,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: C.cyan, marginBottom: '18px' }}>With SaarthiOne</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: C.text, fontSize: '14.5px', fontWeight: 500 }}><Check size={17} style={{ color: C.green }} /> Customer messages on WhatsApp</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: C.text, fontSize: '14.5px', fontWeight: 500 }}><Check size={17} style={{ color: C.green }} /> Saarthi handles the whole conversation</div>
              <div style={{ padding: '20px 16px', borderRadius: '14px', background: 'linear-gradient(135deg, rgba(0,229,255,0.1), rgba(37,211,102,0.08))', border: '1px solid rgba(0,229,255,0.28)', textAlign: 'center', marginTop: '4px' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>Lead → Quote → Booking → Payment → Follow-up</div>
                <div style={{ fontSize: '13px', color: C.green, marginTop: '6px', fontWeight: 600 }}>…all happen automatically.</div>
              </div>
            </div>
            <div style={{ marginTop: '16px', color: C.green, fontSize: '13px', fontWeight: 600 }}>One conversation. Nothing slips.</div>
          </div>
        </Reveal>
      </section>

      {/* ─── AI team ─── */}
      <section id="team" style={{ backgroundColor: C.raised, borderTop: `1px solid ${C.line}` }}>
        <div className="lp-section" style={sectionPad}>
          <Reveal style={{ textAlign: 'center', marginBottom: '20px' }}>
            <Eyebrow>Your AI team · ₹0 salary · works 24×7</Eyebrow>
            <H2>Four teammates. One WhatsApp number.</H2>
            <p style={{ color: C.muted, fontSize: '16px', maxWidth: '560px', margin: '16px auto 0', lineHeight: 1.6 }}>Not chatbots — teammates that actually complete the work, each trained for a role in your business.</p>
          </Reveal>
          <div className="lp-team" style={{ display: 'grid', gap: '18px', marginTop: '44px' }}>
            {AI_TEAM.map((m, i) => (
              <Reveal key={m.name} delay={i * 80}>
                <div className="lp-card" style={{ backgroundColor: C.card, borderRadius: '18px', padding: '24px', border: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '32px' }}>{m.avatar}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '4px 9px', borderRadius: '20px', backgroundColor: 'rgba(37,211,102,0.1)', color: C.green, display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: C.green }} /> Active</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', fontFamily: 'Outfit, sans-serif' }}>{m.name} AI</h3>
                    <p style={{ fontSize: '13px', color: m.color, fontWeight: 500, marginTop: '4px' }}>{m.tagline}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', borderTop: `1px solid ${C.line}`, paddingTop: '14px' }}>
                    {m.tasks.map((t) => (
                      <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#c3cad6' }}>
                        <Check size={15} style={{ color: m.color, flexShrink: 0, marginTop: '2px' }} /><span>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section id="how" className="lp-section" style={sectionPad}>
        <Reveal style={{ textAlign: 'center', marginBottom: '50px' }}>
          <Eyebrow>How it works</Eyebrow>
          <H2>One thread, from “hello” to paid.</H2>
          <p style={{ color: C.muted, fontSize: '16px', maxWidth: '600px', margin: '16px auto 0', lineHeight: 1.6 }}>Every step below happens inside the same WhatsApp conversation — no forms, no portals, no waiting.</p>
        </Reveal>
        <div className="lp-smb" style={{ display: 'grid', gap: '48px', alignItems: 'center' }}>
          <Reveal style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { n: '01', icon: '👋', t: 'A customer taps “Chat on WhatsApp”', d: 'From your ad, bio or website — the thread opens already knowing which offer brought them in.' },
              { n: '02', icon: '🤖', t: 'Saarthi qualifies and recommends', d: 'It asks a few natural questions, captures a qualified lead, and suggests the right package from your real catalogue.' },
              { n: '03', icon: '💳', t: 'It quotes, charges and confirms', d: 'A secure Razorpay link goes into the chat. Payment verified → booking confirmed → itinerary sent. Automatically.' },
              { n: '04', icon: '🔁', t: 'It keeps the relationship warm', d: 'Consent-safe reminders, a “how was it?” after, and a returning-customer offer next season.' },
            ].map((s, i) => (
              <div key={s.n} style={{ display: 'flex', gap: '16px', padding: '18px', borderRadius: '16px', backgroundColor: i === 1 || i === 2 ? 'rgba(0,229,255,0.04)' : 'transparent', border: `1px solid ${i === 1 || i === 2 ? 'rgba(0,229,255,0.16)' : C.line}` }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: C.card, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>{s.icon}</div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '12px', color: C.cyan, fontWeight: 700 }}>{s.n}</span>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>{s.t}</h3>
                  </div>
                  <p style={{ color: C.muted, fontSize: '14px', lineHeight: 1.55 }}>{s.d}</p>
                </div>
              </div>
            ))}
          </Reveal>
          <Reveal delay={120} style={{ display: 'flex', justifyContent: 'center' }}>
            <PhoneThread msgs={HERO_THREAD} />
          </Reveal>
        </div>
      </section>

      {/* ─── Verticals ─── */}
      <section style={{ backgroundColor: C.raised, borderTop: `1px solid ${C.line}` }}>
        <div className="lp-section" style={sectionPad}>
          <Reveal style={{ textAlign: 'center', marginBottom: '40px' }}>
            <Eyebrow>Built for your business</Eyebrow>
            <H2>Pre-trained for the way you sell.</H2>
          </Reveal>
          <Reveal className="lp-verticals" style={{ display: 'grid', gap: '14px' }}>
            {VERTICALS.map((a) => (
              <div key={a.name} className="lp-card" style={{ backgroundColor: C.card, borderRadius: '14px', padding: '22px 12px', border: `1px solid ${C.line}`, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: C.cyan }}>{a.icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#e9f0ff' }}>{a.name}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ─── Growth Services Suite (Interactive Carousel) ─── */}
      <section id="services-suite" style={{ backgroundColor: C.bg, borderTop: `1px solid ${C.line}`, padding: '96px 0' }}>
        <div style={{ maxWidth: `${MAXW}px`, margin: '0 auto', padding: '0 32px' }}>
          <Reveal style={{ textAlign: 'center', marginBottom: '40px' }}>
            <Eyebrow color={C.cyan}>SaarthiOne Growth Suite</Eyebrow>
            <H2>Full-Spectrum Business Growth &amp; Automation</H2>
            <p style={{ color: C.muted, fontSize: '16px', maxWidth: '640px', margin: '14px auto 0', lineHeight: 1.6 }}>
              From hyper-local SEO ranking and targeted lead generation to 24/7 multi-channel chat automation — powered by SaarthiOne.
            </p>
          </Reveal>

          {/* Carousel Slide Indicators */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '32px', flexWrap: 'wrap' }}>
            {GROWTH_SERVICES.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setActiveGrowthSlide(idx)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: idx === activeGrowthSlide ? `1.5px solid ${C.cyan}` : `1px solid ${C.line}`,
                  backgroundColor: idx === activeGrowthSlide ? 'rgba(0, 229, 255, 0.1)' : C.card,
                  color: idx === activeGrowthSlide ? C.cyan : C.muted,
                  fontWeight: 700,
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {s.num.split(' ')[0]} {s.title}
              </button>
            ))}
          </div>

          {/* Active Carousel Card */}
          {(() => {
            const current = GROWTH_SERVICES[activeGrowthSlide]!;
            return (
              <Reveal key={current.id}>
                <div
                  style={{
                    backgroundColor: C.card,
                    borderRadius: '24px',
                    border: `1px solid ${C.line}`,
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '40px',
                    padding: '48px',
                    alignItems: 'center',
                    minHeight: '480px',
                  }}
                  className="lp-smb"
                >
                  {/* Left Column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '5px 14px', borderRadius: '20px', backgroundColor: 'rgba(0, 229, 255, 0.08)', border: '1px solid rgba(0, 229, 255, 0.25)', color: C.cyan, width: 'fit-content', fontSize: '13px', fontWeight: 800, fontFamily: 'monospace' }}>
                      <Sparkles size={14} /> {current.num}
                    </div>
                    <h3 style={{ fontSize: '38px', fontWeight: 800, color: '#fff', fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
                      {current.title}
                    </h3>
                    <p style={{ color: C.muted, fontSize: '15px', lineHeight: 1.65 }}>
                      {current.description}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '8px 0' }}>
                      {current.highlights.map((h) => (
                        <div key={h} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14.5px', color: '#e2e8f0', fontWeight: 500 }}>
                          <span style={{ width: '22px', height: '22px', borderRadius: '50%', border: `1.5px solid ${current.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Check size={13} style={{ color: current.color }} />
                          </span>
                          {h}
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setModalGrowthService(current)}
                        style={{
                          padding: '14px 28px',
                          borderRadius: '30px',
                          background: `linear-gradient(135deg, ${current.color}, ${current.accent})`,
                          color: '#000',
                          border: 'none',
                          fontWeight: 800,
                          fontSize: '14.5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '10px',
                          boxShadow: `0 8px 24px ${current.color}40`,
                        }}
                      >
                        {current.btnText} <ArrowRight size={17} />
                      </button>

                      <button
                        onClick={() => setActiveGrowthSlide((activeGrowthSlide + 1) % GROWTH_SERVICES.length)}
                        style={{
                          background: 'transparent',
                          color: C.muted,
                          border: 'none',
                          fontWeight: 700,
                          fontSize: '14.5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        Next service <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Visual Dashboard Mockup with Floating Badge */}
                  <div style={{ position: 'relative', height: '100%', minHeight: '340px', borderRadius: '18px', backgroundColor: '#070b12', border: `1px solid ${C.line}`, overflow: 'hidden', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    {/* Top Dashboard Bar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.line}`, paddingBottom: '14px' }}>
                      <span style={{ fontSize: '12px', color: C.faint, fontWeight: 600 }}>Site: Last 6 months ✎</span>
                      <span style={{ fontSize: '12px', color: C.cyan, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>+ NEW</span>
                    </div>

                    {/* Stats Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', margin: '20px 0' }}>
                      <div style={{ backgroundColor: 'rgba(0, 229, 255, 0.08)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(0, 229, 255, 0.2)' }}>
                        <div style={{ fontSize: '11px', color: C.faint }}>Total impressions</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: C.cyan, marginTop: '4px' }}>{current.stats?.impressions ?? '17.6K'}</div>
                      </div>
                      <div style={{ backgroundColor: 'rgba(37, 211, 102, 0.08)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(37, 211, 102, 0.2)' }}>
                        <div style={{ fontSize: '11px', color: C.faint }}>Average CTR</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: C.green, marginTop: '4px' }}>{current.stats?.ctr ?? '1.3%'}</div>
                      </div>
                      <div style={{ backgroundColor: 'rgba(255, 165, 0, 0.08)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(255, 165, 0, 0.2)' }}>
                        <div style={{ fontSize: '11px', color: C.faint }}>Average position</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: '#FFA500', marginTop: '4px' }}>{current.stats?.position ?? '25.2'}</div>
                      </div>
                    </div>

                    {/* SVG Line Graph Visualization */}
                    <div style={{ height: '140px', width: '100%', position: 'relative', marginTop: '10px' }}>
                      <svg width="100%" height="100%" viewBox="0 0 400 120" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={`grad-${current.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={current.color} stopOpacity="0.4" />
                            <stop offset="100%" stopColor={current.color} stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d="M0,90 Q50,30 100,70 T200,40 T300,80 T400,20 L400,120 L0,120 Z" fill={`url(#grad-${current.id})`} />
                        <path d="M0,90 Q50,30 100,70 T200,40 T300,80 T400,20" fill="none" stroke={current.color} strokeWidth="3.5" />
                        <path d="M0,100 Q60,50 120,80 T240,60 T360,90 L400,40" fill="none" stroke={current.accent} strokeWidth="2.5" strokeDasharray="4 4" />
                      </svg>
                    </div>

                    {/* Floating Bottom-Right Service Badge */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '16px',
                        right: '16px',
                        backgroundColor: '#fff',
                        color: '#000',
                        borderRadius: '16px',
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
                      }}
                    >
                      <span
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '10px',
                          backgroundColor: current.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#000',
                          fontWeight: 800,
                        }}
                      >
                        <BarChart3 size={18} />
                      </span>
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GROWTH SERVICE</div>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{current.title}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })()}
        </div>
      </section>

      {/* ─── Service Detail Modal Popup ─── */}
      {modalGrowthService && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ backgroundColor: C.card, borderRadius: '24px', border: `1px solid ${C.cyan}`, padding: '36px', maxWidth: '560px', width: '100%', position: 'relative', boxShadow: '0 20px 50px rgba(0,229,255,0.2)' }}>
            <button onClick={() => setModalGrowthService(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', color: C.muted, fontSize: '20px', cursor: 'pointer' }}>✕</button>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '16px', backgroundColor: 'rgba(0,229,255,0.1)', color: C.cyan, fontSize: '12px', fontWeight: 800, marginBottom: '14px' }}>
              {modalGrowthService.num} · {modalGrowthService.badgeText}
            </div>

            <h3 style={{ fontSize: '28px', fontWeight: 800, color: '#fff', fontFamily: 'Outfit, sans-serif', marginBottom: '12px' }}>
              {modalGrowthService.title}
            </h3>

            <p style={{ color: C.muted, fontSize: '14.5px', lineHeight: 1.6, marginBottom: '20px' }}>
              {modalGrowthService.description}
            </p>

            <div style={{ backgroundColor: '#070b12', borderRadius: '16px', padding: '16px', border: `1px solid ${C.line}`, marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>Included Core Deliverables:</div>
              {modalGrowthService.highlights.map((h) => (
                <div key={h} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: '#cbd5e1', marginBottom: '6px' }}>
                  <Check size={15} style={{ color: C.green }} /> {h}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => { setModalGrowthService(null); onLaunchApp(); }} style={{ ...primaryBtn, flex: 1, justifyContent: 'center' }}>
                Launch in Operator Dashboard <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Security & trust ─── */}
      <section id="security" className="lp-section" style={sectionPad}>
        <Reveal style={{ textAlign: 'center', marginBottom: '48px' }}>
          <Eyebrow color={C.green}>Security & trust</Eyebrow>
          <H2>Enterprise-grade, out of the box.</H2>
          <p style={{ color: C.muted, fontSize: '16px', maxWidth: '600px', margin: '16px auto 0', lineHeight: 1.6 }}>The safeguards big companies pay teams to build — already wired in, on every plan.</p>
        </Reveal>
        <div className="lp-security" style={{ display: 'grid', gap: '18px' }}>
          {SECURITY.map((s, i) => (
            <Reveal key={s.title} delay={i * 60}>
              <div className="lp-card" style={{ backgroundColor: C.card, borderRadius: '16px', padding: '24px', border: `1px solid ${C.line}`, height: '100%' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '11px', background: 'rgba(37,211,102,0.1)', color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>{s.icon}</div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '7px' }}>{s.title}</h3>
                <p style={{ color: C.muted, fontSize: '13.5px', lineHeight: 1.6 }}>{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" style={{ backgroundColor: C.raised, borderTop: `1px solid ${C.line}` }}>
        <div className="lp-section" style={sectionPad}>
          <Reveal style={{ textAlign: 'center', marginBottom: '48px' }}>
            <Eyebrow>Pricing</Eyebrow>
            <H2>Simple plans that grow with you.</H2>
            <p style={{ color: C.muted, fontSize: '16px', margin: '16px auto 0' }}>Per business, per month. No setup fees. Cancel anytime.</p>
          </Reveal>
          <div className="lp-pricing" style={{ display: 'grid', gap: '20px', alignItems: 'stretch' }}>
            {PRICING.map((p, i) => (
              <Reveal key={p.id} delay={i * 80} style={{ height: '100%' }}>
                <div className="lp-card" style={{ position: 'relative', backgroundColor: p.highlight ? '#0c1522' : C.card, borderRadius: '20px', padding: '30px 26px', border: p.highlight ? `1.5px solid ${C.cyan}` : `1px solid ${C.line}`, boxShadow: p.highlight ? '0 0 50px rgba(0,229,255,0.1)' : 'none', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  {p.highlight && <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: `linear-gradient(135deg, ${C.cyan}, ${C.cyan2})`, color: '#00232b', fontSize: '11px', fontWeight: 800, padding: '5px 14px', borderRadius: '20px', letterSpacing: '0.5px' }}>MOST POPULAR</div>}
                  <div style={{ fontSize: '15px', fontWeight: 700, color: p.highlight ? C.cyan : '#fff', fontFamily: 'Outfit, sans-serif' }}>{p.name}</div>
                  <div style={{ color: C.muted, fontSize: '13px', marginTop: '4px', marginBottom: '18px' }}>{p.tagline}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '22px' }}>
                    <span style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{p.price}</span>
                    <span style={{ color: C.faint, fontSize: '14px' }}>/ month</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', marginBottom: '26px', flex: 1 }}>
                    {p.features.map((f) => (
                      <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', fontSize: '13.5px', color: '#c3cad6' }}>
                        <Check size={16} style={{ color: p.highlight ? C.cyan : C.green, flexShrink: 0, marginTop: '1px' }} /><span>{f}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={onLaunchApp} style={p.highlight ? { ...primaryBtn, width: '100%', justifyContent: 'center' } : { ...ghostBtn, width: '100%', justifyContent: 'center', borderColor: C.line }}>
                    Get started
                  </button>
                </div>
              </Reveal>
            ))}
          </div>
          <p style={{ textAlign: 'center', color: C.faint, fontSize: '13px', marginTop: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
            <Clock size={14} /> WhatsApp conversation charges from Meta are billed at cost, separately.
          </p>
        </div>
      </section>

      {/* ─── Why different ─── */}
      <section className="lp-section" style={{ ...sectionPad, maxWidth: '840px' }}>
        <Reveal style={{ textAlign: 'center', marginBottom: '44px' }}>
          <Eyebrow>Not another chatbot</Eyebrow>
          <H2>Why we’re different.</H2>
        </Reveal>
        <Reveal style={{ borderRadius: '18px', overflow: 'hidden', border: `1px solid ${C.line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: '#11151f' }}>
            <div style={{ padding: '15px 22px', fontWeight: 700, fontSize: '13px', color: C.faint }}>Others</div>
            <div style={{ padding: '15px 22px', fontWeight: 700, fontSize: '13px', color: C.cyan, borderLeft: `1px solid ${C.line}` }}>SaarthiOne</div>
          </div>
          {WHY_DIFFERENT.map(([a, b], i) => (
            <div key={a} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: i % 2 ? '#0b0e15' : C.card, borderTop: `1px solid ${C.lineSoft}` }}>
              <div style={{ padding: '15px 22px', fontSize: '13.5px', color: C.muted }}>{a}</div>
              <div style={{ padding: '15px 22px', fontSize: '13.5px', color: '#e9f0ff', fontWeight: 600, borderLeft: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: '8px' }}><Check size={15} style={{ color: C.green, flexShrink: 0 }} /> {b}</div>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" style={{ backgroundColor: C.raised, borderTop: `1px solid ${C.line}` }}>
        <div className="lp-section" style={{ ...sectionPad, maxWidth: '780px' }}>
          <Reveal style={{ textAlign: 'center', marginBottom: '40px' }}>
            <Eyebrow>Questions</Eyebrow>
            <H2>Everything you’re wondering.</H2>
          </Reveal>
          <Reveal>
            {FAQ.map((f, i) => (
              <div key={f.q} className={`lp-faq-item ${openFaq === i ? 'open' : ''}`}>
                <button className="lp-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>{f.q}</span>
                  <Plus size={18} className="lp-faq-chev" style={{ color: C.cyan, flexShrink: 0, transition: 'transform 0.3s' }} />
                </button>
                <div className="lp-faq-a"><p style={{ padding: '0 4px 20px', color: C.muted, fontSize: '14.5px', lineHeight: 1.65 }}>{f.a}</p></div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ─── Final CTA + waitlist ─── */}
      <section id="waitlist" className="lp-section" style={{ ...sectionPad, maxWidth: '760px', textAlign: 'center' }}>
        <Reveal>
          <div style={{ background: 'linear-gradient(135deg, rgba(0,229,255,0.06), rgba(37,211,102,0.05))', border: `1px solid ${C.line}`, borderRadius: '26px', padding: '52px 32px' }}>
            <H2>Give your business an AI teammate.</H2>
            <p style={{ color: C.muted, fontSize: '17px', margin: '16px auto 30px', maxWidth: '520px', lineHeight: 1.6 }}>
              Go live on WhatsApp in five minutes — or leave your email and we’ll help you get set up.
            </p>
            <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '34px' }}>
              <button onClick={onLaunchApp} style={{ ...primaryBtn, padding: '16px 30px', fontSize: '16px' }}>Get started free <ArrowRight size={18} /></button>
            </div>

            {wlState === 'done' ? (
              <div style={{ maxWidth: '440px', margin: '0 auto', backgroundColor: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.35)', borderRadius: '16px', padding: '26px' }}>
                <Check size={34} style={{ color: C.green, marginBottom: '10px' }} />
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>You’re on the list! 🎉</h3>
                <p style={{ color: C.muted, fontSize: '14px' }}>We’ll reach out at <strong style={{ color: C.green }}>{wlEmail}</strong> shortly.</p>
              </div>
            ) : (
              <form onSubmit={submitWaitlist} style={{ maxWidth: '460px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ color: C.faint, fontSize: '13px', marginBottom: '2px' }}>Not ready? Get onboarding help by email.</div>
                <input type="email" required placeholder="you@business.com" value={wlEmail} onChange={(e) => setWlEmail(e.target.value)}
                  style={{ padding: '14px 16px', borderRadius: '11px', backgroundColor: '#0b0e15', border: `1px solid ${C.line}`, color: '#fff', fontSize: '15px', outline: 'none' }} />
                <select value={wlType} onChange={(e) => setWlType(e.target.value)}
                  style={{ padding: '14px 16px', borderRadius: '11px', backgroundColor: '#0b0e15', border: `1px solid ${C.line}`, color: wlType ? '#fff' : C.faint, fontSize: '15px', outline: 'none' }}>
                  <option value="">Business type…</option>
                  {VERTICALS.map((a) => <option key={a.name} value={a.name} style={{ color: '#000' }}>{a.name}</option>)}
                  <option value="Other" style={{ color: '#000' }}>Other</option>
                </select>
                {wlError && <div style={{ color: '#ff6b6b', fontSize: '13px' }}>{wlError}</div>}
                <button type="submit" disabled={wlState === 'submitting'} style={{ ...ghostBtn, justifyContent: 'center', borderColor: C.line }}>
                  {wlState === 'submitting' ? <><Loader size={16} className="spin" /> Joining…</> : <>Email me setup help <ArrowRight size={16} /></>}
                </button>
              </form>
            )}
          </div>
        </Reveal>
      </section>

      {/* ─── Footer ─── */}
      <footer style={{ backgroundColor: '#04070b', borderTop: `1px solid ${C.line}`, padding: '56px 32px 40px' }}>
        <div style={{ maxWidth: `${MAXW}px`, margin: '0 auto', display: 'flex', justifyContent: 'space-between', gap: '32px', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <img src="/saarthione-peacock-feather-v2.png" alt="SaarthiOne" width={28} height={28} style={{ borderRadius: '7px' }} />
              <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '18px' }}>Saarthi<span style={{ color: C.cyan }}>One</span></span>
            </div>
            <p style={{ color: C.faint, fontSize: '13.5px', lineHeight: 1.6 }}>The AI teammate that runs your business on WhatsApp — from first hello to paid booking.</p>
          </div>
          <div style={{ display: 'flex', gap: '56px', flexWrap: 'wrap' }}>
            {[
              { h: 'Product', links: [['How it works', () => scrollTo('how')], ['Security', () => scrollTo('security')], ['Pricing', () => scrollTo('pricing')], ['Sign in', onLaunchApp]] as [string, () => void][] },
              { h: 'Company', links: [['FAQ', () => scrollTo('faq')], ['Get started', onLaunchApp], ['Contact', () => scrollTo('waitlist')]] as [string, () => void][] },
              { h: 'Legal', links: [['Privacy', () => openLegal('privacy')], ['Terms', () => openLegal('terms')]] as [string, () => void][] },
            ].map((col) => (
              <div key={col.h}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '14px' }}>{col.h}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {col.links.map(([label, fn]) => (
                    <a key={label} onClick={fn} style={linkStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>{label}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ maxWidth: `${MAXW}px`, margin: '36px auto 0', paddingTop: '24px', borderTop: `1px solid ${C.lineSoft}`, color: C.faint, fontSize: '12.5px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <span>© 2026 SaarthiOne. All rights reserved.</span>
          <span>Made for small businesses in India 🇮🇳</span>
        </div>
      </footer>
    </div>
  );
}
