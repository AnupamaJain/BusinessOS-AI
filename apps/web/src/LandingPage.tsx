import React, { useState } from 'react';
import {
  Sparkles, ArrowRight, Play, CheckCircle, Check,
  Compass, Utensils, Stethoscope, Scissors, GraduationCap, ShoppingBag, Briefcase,
  Wrench, Loader,
} from 'lucide-react';
import { joinWaitlist } from './lib/api';

interface LandingPageProps {
  onLaunchApp: () => void;
  onStartOnboarding: () => void;
}

// ─── Customer Journey (discovery → loyalty) ─────────────────────────────
type ScreenItem =
  | { kind: 'sys'; text: string }
  | { kind: 'in'; text: React.ReactNode; time: string }
  | { kind: 'out'; text: React.ReactNode; time: string }
  | { kind: 'card'; loc: string; price: string; title: string; incl: string[]; time: string }
  | { kind: 'list'; head: string; opts: { name: string; sub: string; sel?: boolean }[] }
  | { kind: 'pay'; who: string; sub: string; amount: string; note: string };

interface JourneyStage {
  num: string;
  phase: string;
  title: string;
  body: string;
  tags: string[];
  sub: string;
  screen: ScreenItem[];
}

const JOURNEY_STAGES: JourneyStage[] = [
  {
    num: '01', phase: 'Discover', title: 'It starts with a single tap.',
    body: 'Aarav taps “Chat on WhatsApp” from an Instagram ad. No landing page, no lead form — the thread opens already knowing which offer brought him in, and Saarthi greets him instantly.',
    tags: ['entry · click-to-WhatsApp ad', 'creates · contact + consent'],
    sub: 'Business account · replies instantly',
    screen: [
      { kind: 'sys', text: '›› This chat started from an ad on Instagram.' },
      { kind: 'sys', text: '🔒 Messages are handled by an AI assistant. A human can take over anytime.' },
      { kind: 'in', text: 'Namaste Aarav! 🌏 I’m Saarthi, your travel concierge. I saw you were looking at our island getaways — want me to find the perfect trip for you?', time: '11:04' },
      { kind: 'out', text: 'Yes please! Thinking of a honeymoon.', time: '11:04' },
    ],
  },
  {
    num: '02', phase: 'Understand', title: 'A few natural questions, not a form.',
    body: 'Instead of a 12-field enquiry form, Saarthi asks the way a good agent would — dates, travellers, budget — one message at a time. Every answer is captured as a qualified lead the moment it’s given.',
    tags: ['intent · LLM classifier → sales', 'tool · upsert_qualified_lead'],
    sub: 'typing…',
    screen: [
      { kind: 'in', text: 'Congratulations! 🎉 To tailor this, may I ask a few quick things — when are you travelling, and for how many people?', time: '11:05' },
      { kind: 'out', text: 'Mid-October, 2 of us. Budget around ₹1 lakh each.', time: '11:06' },
      { kind: 'in', text: 'Perfect — beaches or mountains for the honeymoon? 🏝️⛰️', time: '11:06' },
      { kind: 'out', text: 'Beaches, definitely.', time: '11:06' },
    ],
  },
  {
    num: '03', phase: 'Recommend', title: 'A grounded recommendation, not a guess.',
    body: 'Saarthi searches the real package catalogue and answers with an offer it can stand behind — accurate title, price, and inclusions pulled straight from your own data. No invented products, no wrong prices.',
    tags: ['tool · search_travel_packages', 'grounded by · catalogue + RAG'],
    sub: 'Business account',
    screen: [
      { kind: 'in', text: 'I’ve got a feeling you’ll love this one. 💫', time: '11:07' },
      { kind: 'card', loc: '🌴 Bali, Indonesia', price: '₹49,999 / person', title: 'Bali Honeymoon & Romance Escapes · 5N / 6D', incl: ['4-Star villa with private pool', 'Daily breakfast + candlelight dinner', 'Nusa Penida island tour'], time: '11:07' },
      { kind: 'out', text: 'Ooh that looks perfect 😍', time: '11:08' },
    ],
  },
  {
    num: '04', phase: 'Choose', title: 'Choose right inside the chat.',
    body: 'Options arrive as a tappable list — room tiers, add-ons, dates — so choosing feels like picking a reply, not filling a cart. The selection flows back into the thread as a confirmed quote.',
    tags: ['ui · in-thread list picker', 'tool · create quote'],
    sub: 'Business account',
    screen: [
      { kind: 'in', text: 'Lovely! Pick your villa and I’ll lock the price. 🏡', time: '11:09' },
      { kind: 'list', head: '🏝️ Choose your stay', opts: [
        { name: 'Private Pool Villa', sub: '5N · sea view · ₹49,999 / person', sel: true },
        { name: 'Garden Suite', sub: '5N · garden view · ₹42,999 / person' },
        { name: 'Beachfront Villa', sub: '5N · beachfront · ₹61,999 / person' },
      ] },
      { kind: 'out', text: 'Private Pool Villa for 2 🙌', time: '11:10' },
    ],
  },
  {
    num: '05', phase: 'Pay', title: 'Pay without ever leaving WhatsApp.',
    body: 'Saarthi generates a secure payment link and drops it into the thread. Aarav pays with UPI or card in a couple of taps — and the booking flips to confirmed the instant the payment webhook fires.',
    tags: ['gateway · Razorpay payment link', 'verified · signed webhook → paid'],
    sub: 'Business account',
    screen: [
      { kind: 'in', text: <>All set! Total for 2 travellers: <b>₹99,998</b>. Here’s your secure payment link 👇</>, time: '11:11' },
      { kind: 'pay', who: 'Wanderlust Travel', sub: 'Bali Honeymoon · 2 travellers', amount: '₹99,998', note: 'UPI · Cards · Netbanking — via Razorpay' },
      { kind: 'out', text: 'Paid! ✅', time: '11:12' },
      { kind: 'in', text: <>🎉 Booking <b>BK-48213</b> confirmed! Your itinerary and villa voucher are on the way.</>, time: '11:12' },
    ],
  },
  {
    num: '06', phase: 'Retain', title: 'The relationship doesn’t end at checkout.',
    body: 'Consent-safe follow-ups keep the thread warm — a pre-trip checklist, a “how was it?” after, and a returning-guest offer next season. Every message respects opt-out and the sending window.',
    tags: ['engine · scheduler + templates', 'guardrail · consent + 09–21h'],
    sub: 'Business account',
    screen: [
      { kind: 'sys', text: '— 3 days before travel —' },
      { kind: 'in', text: '✈️ Bali countdown! Your packing checklist & e-visa steps are ready. Want them now?', time: '09:30' },
      { kind: 'sys', text: '— 1 week after travel —' },
      { kind: 'in', text: <>Welcome home, Aarav! 🥥 How was the honeymoon? Leave a quick review and unlock <b>10% off</b> your next escape.</>, time: '18:15' },
      { kind: 'out', text: 'It was magical, thank you! ⭐⭐⭐⭐⭐', time: '18:20' },
    ],
  },
];

function JourneyPhone({ sub, screen }: { sub: string; screen: ScreenItem[] }) {
  return (
    <div style={{
      width: '330px', maxWidth: '100%', backgroundColor: '#0b141a',
      borderRadius: '26px', border: '1px solid rgba(0, 242, 254, 0.25)',
      boxShadow: '0 20px 50px rgba(0,0,0,0.7), 0 0 30px rgba(0, 242, 254, 0.08)', overflow: 'hidden',
    }}>
      {/* WhatsApp header */}
      <div style={{ backgroundColor: '#1f2c34', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px' }}>
        <span style={{ color: '#8696a0', fontSize: '18px' }}>‹</span>
        <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'linear-gradient(135deg, #00f2fe, #4facfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>🧭</div>
        <div style={{ lineHeight: 1.25, minWidth: 0 }}>
          <div style={{ color: '#e9edef', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            Wanderlust Travel <span style={{ color: '#53bdeb', fontSize: '11px' }}>✔</span>
          </div>
          <div style={{ color: '#8696a0', fontSize: '11px' }}>{sub}</div>
        </div>
        <div style={{ marginLeft: 'auto', color: '#8696a0', display: 'flex', gap: '14px', fontSize: '14px' }}>📞 ⋮</div>
      </div>
      {/* Chat body */}
      <div style={{ padding: '14px 12px', minHeight: '300px', display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#0b141a', backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {screen.map((item, i) => {
          if (item.kind === 'sys') {
            return <div key={i} style={{ alignSelf: 'center', textAlign: 'center', maxWidth: '85%', background: 'rgba(31,44,52,0.7)', color: '#8696a0', fontSize: '11px', padding: '6px 12px', borderRadius: '9px', lineHeight: 1.4 }}>{item.text}</div>;
          }
          if (item.kind === 'in' || item.kind === 'out') {
            const out = item.kind === 'out';
            return (
              <div key={i} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '84%', backgroundColor: out ? '#005c4b' : '#1f2c34', color: '#e9edef', padding: '7px 10px 6px', borderRadius: out ? '10px 10px 3px 10px' : '10px 10px 10px 3px', fontSize: '13.5px', lineHeight: 1.42 }}>
                {item.text}
                <span style={{ display: 'block', textAlign: 'right', color: '#8696a0', fontSize: '10px', marginTop: '3px' }}>
                  {!out && <span style={{ color: '#00f2fe', fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.04em', marginRight: '5px' }}>AI</span>}
                  {item.time}{out && <span style={{ color: '#53bdeb' }}> ✓✓</span>}
                </span>
              </div>
            );
          }
          if (item.kind === 'card') {
            return (
              <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: '#1f2c34', borderRadius: '10px 10px 10px 3px', overflow: 'hidden' }}>
                <div style={{ height: '90px', background: 'linear-gradient(120deg, rgba(0,242,254,0.25), rgba(43,108,255,0.25)), linear-gradient(180deg, #0e7c86, #0a4a6b)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '8px 10px' }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '13px', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{item.loc}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#fff', background: 'rgba(0,0,0,0.35)', padding: '3px 7px', borderRadius: '6px' }}>{item.price}</span>
                </div>
                <div style={{ padding: '10px 11px 11px' }}>
                  <div style={{ color: '#e9edef', fontWeight: 700, fontSize: '13px' }}>{item.title}</div>
                  <ul style={{ margin: '8px 0 0', paddingLeft: '15px', color: '#8696a0', fontSize: '12px', lineHeight: 1.7 }}>
                    {item.incl.map((x, k) => <li key={k}>{x}</li>)}
                  </ul>
                  <div style={{ textAlign: 'right', color: '#8696a0', fontSize: '10px', marginTop: '8px' }}>{item.time}</div>
                </div>
                <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <button style={{ flex: 1, background: 'transparent', border: 'none', color: '#53bdeb', fontSize: '12.5px', padding: '10px 4px' }}>ℹ️ Details</button>
                  <button style={{ flex: 1, background: 'transparent', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.07)', color: '#53bdeb', fontSize: '12.5px', padding: '10px 4px' }}>📅 Check dates</button>
                </div>
              </div>
            );
          }
          if (item.kind === 'list') {
            return (
              <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: '#1f2c34', borderRadius: '10px 10px 10px 3px', padding: '11px 12px' }}>
                <div style={{ color: '#e9edef', fontWeight: 700, fontSize: '13px', marginBottom: '9px' }}>{item.head}</div>
                {item.opts.map((o, k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '8px 0', borderTop: k === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid ' + (o.sel ? '#34d399' : '#8696a0'), marginTop: '2px', flexShrink: 0, background: o.sel ? 'radial-gradient(circle, #34d399 42%, transparent 46%)' : 'transparent' }} />
                    <span>
                      <div style={{ color: '#e9edef', fontSize: '13px', fontWeight: 600 }}>{o.name}</div>
                      <div style={{ color: '#8696a0', fontSize: '11.5px' }}>{o.sub}</div>
                    </span>
                  </div>
                ))}
                <button style={{ marginTop: '10px', background: '#00a884', color: '#04231c', border: 'none', width: '100%', padding: '9px', borderRadius: '8px', fontWeight: 700, fontSize: '13px' }}>Confirm selection</button>
              </div>
            );
          }
          // pay
          return (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: '#1f2c34', borderRadius: '10px 10px 10px 3px', padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'linear-gradient(135deg, #00f2fe, #4facfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🧭</span>
                <span>
                  <div style={{ color: '#e9edef', fontSize: '13px', fontWeight: 700 }}>{item.who}</div>
                  <div style={{ color: '#8696a0', fontSize: '11px' }}>{item.sub}</div>
                </span>
                <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ color: '#e9edef', fontWeight: 700, fontSize: '14px' }}>{item.amount}</div>
                  <div style={{ color: '#8696a0', fontSize: '10px' }}>incl. taxes</div>
                </span>
              </div>
              <button style={{ marginTop: '11px', background: '#00a884', color: '#04231c', border: 'none', width: '100%', padding: '10px', borderRadius: '8px', fontWeight: 700, fontSize: '13px' }}>🔒 Pay securely</button>
              <div style={{ textAlign: 'center', color: '#8696a0', fontSize: '10px', marginTop: '8px' }}>{item.note}</div>
            </div>
          );
        })}
      </div>
      {/* Input bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px 12px', backgroundColor: '#0b141a' }}>
        <span style={{ flex: 1, backgroundColor: '#1f2c34', borderRadius: '20px', padding: '9px 14px', color: '#8696a0', fontSize: '13px' }}>Message</span>
        <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#00a884', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🎤</span>
      </div>
    </div>
  );
}

// ─── Section data ───────────────────────────────────────────────────────

const HERO_FLOW = [
  { icon: '👋', label: 'Customer' },
  { icon: '💬', label: 'WhatsApp' },
  { icon: '🤖', label: 'AI asks the right questions' },
  { icon: '📄', label: 'Quote' },
  { icon: '💳', label: 'Payment' },
  { icon: '📅', label: 'Booking' },
  { icon: '✅', label: 'Done' },
];

const AI_TEAM = [
  { avatar: '💼', name: 'Sales AI', color: '#00f2fe', tagline: 'Turns curious visitors into paying customers.', tasks: ['Qualifies every lead, instantly', 'Recommends the right package', 'Generates quotations on the spot'] },
  { avatar: '🎧', name: 'Support AI', color: '#00ff87', tagline: 'Answers in seconds, escalates when it matters.', tasks: ['Answers FAQs from your own policies', 'Resolves issues 24×7', 'Hands off to a human when needed'] },
  { avatar: '📅', name: 'Booking AI', color: '#4facfe', tagline: 'Fills your calendar without the back-and-forth.', tasks: ['Schedules appointments & slots', 'Confirms and sends reminders', 'Zero double-bookings'] },
  { avatar: '💳', name: 'Finance AI', color: '#feb47b', tagline: 'Gets you paid, on time, every time.', tasks: ['Sends secure payment links', 'Issues invoices & receipts', 'Chases pending payments politely'] },
];

const AUDIENCE = [
  { icon: <Compass size={22} />, name: 'Travel' },
  { icon: <Scissors size={22} />, name: 'Salon' },
  { icon: <Stethoscope size={22} />, name: 'Clinic' },
  { icon: <Utensils size={22} />, name: 'Restaurant' },
  { icon: <GraduationCap size={22} />, name: 'Education' },
  { icon: <ShoppingBag size={22} />, name: 'Retail' },
  { icon: <Briefcase size={22} />, name: 'Professional Services' },
];

const WHY_DIFFERENT = [
  ['AI chat', 'AI teammate'],
  ['Answers questions', 'Completes tasks'],
  ['Five different tools', 'One platform'],
  ['You update everything manually', 'Automatic workflows'],
  ['Dashboard-first', 'Conversation-first'],
];

const ROADMAP = [
  { done: true, label: 'Vision' },
  { done: true, label: 'Architecture' },
  { done: true, label: 'Landing page' },
  { done: true, label: 'Live WhatsApp agent' },
  { done: false, label: 'Travel vertical GA' },
  { done: false, label: 'Public beta' },
];

const DEMO_CHAT: { from: 'customer' | 'agent'; text: string }[] = [
  { from: 'customer', text: 'Hi! Need a Bali honeymoon package 🌴' },
  { from: 'agent', text: 'Congrats! 🎉 What are your travel dates and budget per person?' },
  { from: 'customer', text: 'Mid-October, around ₹50k each, 2 of us.' },
  { from: 'agent', text: 'Perfect — our Bali Romance Escape (5N/6D) is ₹49,999/person: private-pool villa, daily breakfast, candlelight dinner & Nusa Penida tour. Shall I hold it?' },
  { from: 'customer', text: 'Yes please!' },
  { from: 'agent', text: '✅ Held for 2 travellers — total ₹99,998. Here’s your secure payment link 👉 pay it and I’ll confirm the booking + send your itinerary.' },
];

// ─── Reusable bits ────────────────────────────────────────────────────────

function Eyebrow({ children, color = '#00f2fe' }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontSize: '12px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px', fontFamily: 'monospace' }}>
      {children}
    </div>
  );
}

function ChainStep({ text, danger }: { text: string; danger?: boolean }) {
  return (
    <div style={{
      padding: '11px 16px', borderRadius: '10px', fontSize: '14px', textAlign: 'center', fontWeight: 500,
      backgroundColor: danger ? 'rgba(255,107,107,0.06)' : 'rgba(0,242,254,0.06)',
      border: `1px solid ${danger ? 'rgba(255,107,107,0.25)' : 'rgba(0,242,254,0.25)'}`,
      color: danger ? '#ffb4b4' : '#d6f7ff',
    }}>{text}</div>
  );
}

// ─── Landing page ─────────────────────────────────────────────────────────

export function LandingPage({ onLaunchApp }: LandingPageProps) {
  const [wlEmail, setWlEmail] = useState('');
  const [wlType, setWlType] = useState('');
  const [wlState, setWlState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [wlError, setWlError] = useState<string | null>(null);
  const [demoCount, setDemoCount] = useState(2);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  const submitWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (wlState === 'submitting') return;
    setWlState('submitting');
    setWlError(null);
    const err = await joinWaitlist(wlEmail, wlType || null);
    if (err) { setWlError(err); setWlState('error'); }
    else { setWlState('done'); }
  };

  const linkStyle: React.CSSProperties = { color: '#9ca3af', textDecoration: 'none', transition: 'color 0.2s', cursor: 'pointer' };
  const hoverIn = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.color = '#fff');
  const hoverOut = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.color = '#9ca3af');

  return (
    <div style={{ backgroundColor: '#07090e', color: '#f3f4f6', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>

      {/* ─── Nav ─── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(16px)', backgroundColor: 'rgba(9,11,15,0.85)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <img src="/logo-mark.svg" alt="SaarthiOne" width={34} height={34} style={{ borderRadius: '9px' }} />
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '22px', letterSpacing: '-0.5px' }}>Saarthi<span style={{ color: '#00f2fe' }}>One</span></span>
        </div>
        <div style={{ display: 'flex', gap: '30px', alignItems: 'center', fontSize: '14px', fontWeight: 500 }}>
          <a style={linkStyle} onClick={() => scrollTo('problem')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>The Problem</a>
          <a style={linkStyle} onClick={() => scrollTo('team')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>AI Team</a>
          <a style={linkStyle} onClick={() => scrollTo('journey')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>How it works</a>
          <a style={linkStyle} onClick={() => scrollTo('different')} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>Why different</a>
        </div>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
          <button onClick={onLaunchApp} style={{ padding: '10px 18px', borderRadius: '10px', backgroundColor: '#1a1f2e', color: '#f3f4f6', border: '1px solid rgba(255,255,255,0.12)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>Sign In</button>
          <button onClick={() => scrollTo('waitlist')} style={{ padding: '10px 20px', borderRadius: '10px', background: 'linear-gradient(135deg, #00f2fe, #4facfe)', color: '#000', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer', boxShadow: '0 0 20px rgba(0,242,254,0.3)' }}>Get Early Access</button>
        </div>
      </nav>

      {/* ─── 1. Hero ─── */}
      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '80px 24px 60px', display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: '56px', alignItems: 'center' }} className="hero-grid">
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '20px', backgroundColor: 'rgba(0,242,254,0.08)', border: '1px solid rgba(0,242,254,0.25)', color: '#00f2fe', fontSize: '12px', fontWeight: 600, marginBottom: '24px' }}>
            <Sparkles size={14} /><span>Your AI Business Teammate</span>
          </div>
          <h1 style={{ fontSize: '54px', fontWeight: 800, lineHeight: 1.08, letterSpacing: '-1.5px', marginBottom: '20px', fontFamily: 'Outfit, sans-serif' }}>
            Your AI teammate for<br />
            <span style={{ background: 'linear-gradient(135deg, #00f2fe, #4facfe, #00ff87)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>growing your business.</span>
          </h1>
          <p style={{ fontSize: '18px', color: '#9ca3af', lineHeight: 1.6, marginBottom: '20px', maxWidth: '500px' }}>
            Turn every customer conversation into bookings, sales, payments, and loyal customers — without juggling multiple tools.
          </p>
          <p style={{ fontSize: '15px', color: '#d6f7ff', lineHeight: 1.7, marginBottom: '32px', maxWidth: '500px', fontWeight: 500 }}>
            Never miss a lead. Never forget a follow-up. Never switch between five different tools again.
          </p>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '28px', flexWrap: 'wrap' }}>
            <button onClick={() => scrollTo('waitlist')} style={{ padding: '16px 30px', borderRadius: '12px', background: 'linear-gradient(135deg, #00f2fe, #4facfe)', color: '#000', border: 'none', fontWeight: 700, fontSize: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 0 25px rgba(0,242,254,0.4)' }}>
              🚀 Get Early Access <ArrowRight size={18} />
            </button>
            <button onClick={() => scrollTo('demo')} style={{ padding: '16px 26px', borderRadius: '12px', backgroundColor: '#121620', color: '#f3f4f6', border: '1px solid rgba(255,255,255,0.15)', fontWeight: 600, fontSize: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Play size={16} style={{ color: '#00f2fe' }} /> Watch 2-min Demo
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', color: '#6b7280', fontSize: '13px', flexWrap: 'wrap' }}>
            {['Works on WhatsApp', 'Live in 5 minutes', 'No coding'].map((t) => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle size={16} style={{ color: '#00ff87' }} /> {t}</span>
            ))}
          </div>
        </div>

        {/* Animated flow pipeline */}
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '-30px', borderRadius: '40px', background: 'radial-gradient(circle, rgba(0,242,254,0.14) 0%, transparent 70%)', filter: 'blur(30px)' }} />
          <div style={{ position: 'relative', backgroundColor: '#0c1119', border: '1px solid rgba(0,242,254,0.25)', borderRadius: '22px', padding: '26px 22px', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}>
            <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#00f2fe', letterSpacing: '0.1em', marginBottom: '16px', textAlign: 'center' }}>ONE CONVERSATION · START TO FINISH</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
              {HERO_FLOW.map((n, i) => (
                <React.Fragment key={n.label}>
                  <div className="flow-node" style={{ animationDelay: `${i * 0.35}s`, display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', borderRadius: '12px', backgroundColor: '#111826', border: '1px solid rgba(0,242,254,0.18)' }}>
                    <span style={{ fontSize: '18px', width: '26px', textAlign: 'center' }}>{n.icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#e9f0ff' }}>{n.label}</span>
                  </div>
                  {i < HERO_FLOW.length - 1 && <div style={{ textAlign: 'center', color: '#3b4a63', fontSize: '12px', lineHeight: 0.6 }}>↓</div>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── 2. The Problem ─── */}
      <section id="problem" style={{ backgroundColor: '#0a0d14', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '80px 24px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '50px' }}>
            <Eyebrow color="#ff8f8f">The problem</Eyebrow>
            <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>Running a business shouldn’t mean juggling five tools.</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '30px', alignItems: 'center' }} className="problem-grid">
            <div style={{ backgroundColor: '#0d1117', borderRadius: '18px', padding: '26px', border: '1px solid rgba(255,107,107,0.2)' }}>
              <div style={{ fontWeight: 700, fontSize: '16px', color: '#ffb4b4', marginBottom: '18px' }}>Today, without SaarthiOne</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <ChainStep danger text="Reply on WhatsApp" />
                <div style={{ textAlign: 'center', color: '#5b3a3a' }}>↓</div>
                <ChainStep danger text="Copy details into a CRM" />
                <div style={{ textAlign: 'center', color: '#5b3a3a' }}>↓</div>
                <ChainStep danger text="Open the booking tool" />
                <div style={{ textAlign: 'center', color: '#5b3a3a' }}>↓</div>
                <ChainStep danger text="Create a payment link" />
                <div style={{ textAlign: 'center', color: '#5b3a3a' }}>↓</div>
                <ChainStep danger text="Remember to follow up" />
              </div>
              <div style={{ marginTop: '18px', textAlign: 'center', color: '#ff8f8f', fontSize: '13px', fontWeight: 600 }}>Everything is manual. Something always slips.</div>
            </div>

            <div style={{ fontSize: '28px', color: '#00f2fe', fontWeight: 800, textAlign: 'center' }} className="problem-arrow">→</div>

            <div style={{ backgroundColor: '#0d1420', borderRadius: '18px', padding: '26px', border: '1px solid rgba(0,242,254,0.3)', boxShadow: '0 0 30px rgba(0,242,254,0.08)' }}>
              <div style={{ fontWeight: 700, fontSize: '16px', color: '#00f2fe', marginBottom: '18px' }}>With SaarthiOne</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <ChainStep text="Customer messages on WhatsApp" />
                <div style={{ textAlign: 'center', color: '#1e4a55' }}>↓</div>
                <ChainStep text="Saarthi handles the conversation" />
                <div style={{ textAlign: 'center', color: '#1e4a55' }}>↓</div>
                <div style={{ padding: '20px 16px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(0,242,254,0.12), rgba(79,172,254,0.12))', border: '1px solid rgba(0,242,254,0.35)', textAlign: 'center' }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>Lead → Quote → Booking → Payment → Follow-up</div>
                  <div style={{ fontSize: '13px', color: '#00ff87', marginTop: '6px', fontWeight: 600 }}>…all happen automatically.</div>
                </div>
              </div>
              <div style={{ marginTop: '18px', textAlign: 'center', color: '#00ff87', fontSize: '13px', fontWeight: 600 }}>One conversation. Nothing slips.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 3. The Journey (building blocks + staged mockups) ─── */}
      <section id="journey" style={{ maxWidth: '1200px', margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '46px' }}>
          <Eyebrow>The customer journey</Eyebrow>
          <h2 style={{ fontSize: '40px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '14px' }}>One thread, from discovery to loyalty.</h2>
          <p style={{ color: '#9ca3af', fontSize: '16px', maxWidth: '640px', margin: '0 auto' }}>Meet <strong style={{ color: '#fff' }}>Aarav</strong>. He taps a holiday ad and never leaves the chat again — every screen below is the same conversation, moving forward.</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '30px' }}>
          {JOURNEY_STAGES.map((item, index, arr) => (
            <React.Fragment key={item.num}>
              <div style={{ flex: 1, minWidth: '140px', backgroundColor: '#0e131d', borderRadius: '14px', padding: '20px 14px', textAlign: 'center', border: '1px solid rgba(0,242,254,0.2)' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#00f2fe', marginBottom: '6px' }}>{item.num}</div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{item.phase}</h3>
              </div>
              {index < arr.length - 1 && <span style={{ color: '#00f2fe', flexShrink: 0 }}>›</span>}
            </React.Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {JOURNEY_STAGES.map((stage, idx) => {
            const flip = idx % 2 === 1;
            return (
              <div key={stage.num} className="journey-stage-row" style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: '48px', alignItems: 'center', padding: '38px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ order: flip ? 2 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#00f2fe', fontFamily: 'monospace', fontSize: '13px' }}>
                    <span style={{ height: '1px', width: '38px', background: 'linear-gradient(90deg,#00f2fe,#4facfe)' }} />Stage {stage.num} · {stage.phase}
                  </div>
                  <h3 style={{ fontSize: '25px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', color: '#fff', marginTop: '12px', letterSpacing: '-0.5px' }}>{stage.title}</h3>
                  <p style={{ color: '#9ca3af', fontSize: '15px', lineHeight: 1.6, marginTop: '13px', maxWidth: '430px' }}>{stage.body}</p>
                </div>
                <div style={{ order: flip ? 1 : 2, display: 'flex', justifyContent: 'center' }}>
                  <JourneyPhone sub={stage.sub} screen={stage.screen} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── 4. Meet Your AI Team ─── */}
      <section id="team" style={{ backgroundColor: '#0a0d14', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '90px 24px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <Eyebrow>Now hiring — ₹0 salary, works 24×7</Eyebrow>
            <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>Meet your AI team.</h2>
            <p style={{ color: '#9ca3af', fontSize: '16px', maxWidth: '560px', margin: '14px auto 0' }}>Not chatbots. Teammates that actually complete the work — each trained for a role in your business.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px', marginTop: '44px' }} className="team-grid">
            {AI_TEAM.map((m) => (
              <div key={m.name} style={{ backgroundColor: '#0d1117', borderRadius: '18px', padding: '24px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '34px' }}>{m.avatar}</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '4px 9px', borderRadius: '20px', backgroundColor: 'rgba(0,255,135,0.1)', color: '#00ff87', display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00ff87' }} /> Active</span>
                </div>
                <div>
                  <h3 style={{ fontSize: '19px', fontWeight: 800, color: '#fff' }}>{m.name}</h3>
                  <p style={{ fontSize: '13px', color: m.color, fontWeight: 500, marginTop: '4px' }}>{m.tagline}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '14px' }}>
                  {m.tasks.map((t) => (
                    <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#c3cad6' }}>
                      <Check size={15} style={{ color: m.color, flexShrink: 0, marginTop: '2px' }} /><span>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 5. Who is this for ─── */}
      <section style={{ maxWidth: '1120px', margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '44px' }}>
          <Eyebrow>Built for your business</Eyebrow>
          <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>Who is this for?</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '14px' }} className="audience-grid">
          {AUDIENCE.map((a) => (
            <div key={a.name} style={{ backgroundColor: '#0d1117', borderRadius: '14px', padding: '22px 12px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <span style={{ color: '#00f2fe' }}>{a.icon}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#e9f0ff', lineHeight: 1.3 }}>{a.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 6. Demo conversation ─── */}
      <section id="demo" style={{ backgroundColor: '#0a0d14', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '90px 24px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <Eyebrow>See it in action</Eyebrow>
            <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>One chat. Lead to paid booking.</h2>
            <p style={{ color: '#9ca3af', fontSize: '16px', marginTop: '12px' }}>This explains more than a thousand feature bullets.</p>
          </div>
          <div style={{ maxWidth: '440px', margin: '0 auto' }}>
            <div style={{ backgroundColor: '#0b141a', borderRadius: '20px', border: '1px solid rgba(0,242,254,0.25)', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}>
              <div style={{ backgroundColor: '#1f2c34', display: 'flex', alignItems: 'center', gap: '10px', padding: '13px 16px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'linear-gradient(135deg,#00f2fe,#4facfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>🧭</div>
                <div><div style={{ color: '#e9edef', fontWeight: 600, fontSize: '14px' }}>Wanderlust Travel</div><div style={{ color: '#00ff87', fontSize: '11px' }}>● online · replies instantly</div></div>
              </div>
              <div style={{ padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: '9px', minHeight: '260px', backgroundColor: '#0b141a', backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
                {DEMO_CHAT.slice(0, demoCount).map((m, i) => (
                  <div key={i} style={{ alignSelf: m.from === 'customer' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '9px 12px', borderRadius: m.from === 'customer' ? '12px 12px 3px 12px' : '12px 12px 12px 3px', fontSize: '13.5px', lineHeight: 1.45, color: '#e9edef', backgroundColor: m.from === 'customer' ? '#005c4b' : '#1f2c34' }}>{m.text}</div>
                ))}
              </div>
              <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                {demoCount < DEMO_CHAT.length
                  ? <button onClick={() => setDemoCount((c) => Math.min(c + 1, DEMO_CHAT.length))} style={{ padding: '9px 20px', borderRadius: '10px', background: 'linear-gradient(135deg,#00f2fe,#4facfe)', color: '#000', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>▶ Play next message</button>
                  : <button onClick={() => setDemoCount(2)} style={{ padding: '9px 20px', borderRadius: '10px', backgroundColor: '#121620', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.12)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>↻ Replay</button>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 7. Why SMBs ─── */}
      <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '46px' }}>
          <Eyebrow>Why SaarthiOne</Eyebrow>
          <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>Enterprise power, small-business simple.</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '22px' }} className="smb-grid">
          <div style={{ backgroundColor: '#0d1117', borderRadius: '18px', padding: '28px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#8b93a3', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '18px' }}>Enterprise software</div>
            {['Expensive to license', 'Complex to set up', 'Weeks of training to adopt', 'Needs a dedicated ops team'].map((t) => (
              <div key={t} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '9px 0', color: '#9ca3af', fontSize: '14px' }}><span style={{ color: '#ff6b6b' }}>✕</span> {t}</div>
            ))}
          </div>
          <div style={{ backgroundColor: '#0d1420', borderRadius: '18px', padding: '28px', border: '1px solid rgba(0,242,254,0.3)', boxShadow: '0 0 30px rgba(0,242,254,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '18px' }}>SaarthiOne</div>
            {['Affordable — pay as you grow', 'Conversation-first, nothing to learn', 'Live in 5 minutes on WhatsApp', 'The AI is the ops team'].map((t) => (
              <div key={t} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '9px 0', color: '#d6f7ff', fontSize: '14px', fontWeight: 500 }}><Check size={16} style={{ color: '#00ff87' }} /> {t}</div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 8. Architecture (simple) ─── */}
      <section style={{ backgroundColor: '#0a0d14', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '90px 24px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <Eyebrow>How it fits together</Eyebrow>
          <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '46px' }}>One brain behind the conversation.</h2>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            {[{ e: '🧑', t: 'Customer' }, { e: '💬', t: 'WhatsApp' }, { e: '🧭', t: 'Saarthi AI' }].map((n, i) => (
              <React.Fragment key={n.t}>
                <div style={{ padding: '14px 30px', borderRadius: '14px', backgroundColor: i === 2 ? 'rgba(0,242,254,0.1)' : '#0d1117', border: `1px solid ${i === 2 ? 'rgba(0,242,254,0.4)' : 'rgba(255,255,255,0.1)'}`, fontSize: '16px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '10px', minWidth: '220px', justifyContent: 'center' }}>
                  <span style={{ fontSize: '20px' }}>{n.e}</span> {n.t}
                </div>
                <div style={{ color: '#3b4a63' }}>↓</div>
              </React.Fragment>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', width: '100%', maxWidth: '640px' }} className="arch-grid">
              {[{ e: '👥', t: 'CRM' }, { e: '💳', t: 'Payments' }, { e: '📅', t: 'Booking' }, { e: '📊', t: 'Analytics' }].map((n) => (
                <div key={n.t} style={{ padding: '18px 10px', borderRadius: '12px', backgroundColor: '#0d1117', border: '1px solid rgba(0,242,254,0.2)', fontSize: '13px', fontWeight: 600, color: '#c3cad6' }}>
                  <div style={{ fontSize: '22px', marginBottom: '6px' }}>{n.e}</div>{n.t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── 9. Why different ─── */}
      <section id="different" style={{ maxWidth: '820px', margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '44px' }}>
          <Eyebrow>Not another chatbot</Eyebrow>
          <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>Why we’re different.</h2>
        </div>
        <div style={{ borderRadius: '18px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: '#11151f' }}>
            <div style={{ padding: '16px 24px', fontWeight: 700, fontSize: '14px', color: '#8b93a3' }}>Others</div>
            <div style={{ padding: '16px 24px', fontWeight: 700, fontSize: '14px', color: '#00f2fe', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>SaarthiOne</div>
          </div>
          {WHY_DIFFERENT.map(([a, b], i) => (
            <div key={a} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: i % 2 ? '#0b0e15' : '#0d1117', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ padding: '16px 24px', fontSize: '14px', color: '#9ca3af' }}>{a}</div>
              <div style={{ padding: '16px 24px', fontSize: '14px', color: '#e9f0ff', fontWeight: 600, borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '8px' }}><Check size={15} style={{ color: '#00ff87' }} /> {b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 10. Roadmap ─── */}
      <section style={{ backgroundColor: '#0a0d14', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '80px 24px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <Eyebrow>Building in public</Eyebrow>
            <h2 style={{ fontSize: '34px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>Where we are.</h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
            {ROADMAP.map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '11px 18px', borderRadius: '999px', backgroundColor: r.done ? 'rgba(0,255,135,0.08)' : '#0d1117', border: `1px solid ${r.done ? 'rgba(0,255,135,0.3)' : 'rgba(255,255,255,0.12)'}`, fontSize: '14px', fontWeight: 600, color: r.done ? '#00ff87' : '#9ca3af' }}>
                {r.done ? <Check size={15} /> : <Wrench size={14} />} {r.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 11. Waitlist ─── */}
      <section id="waitlist" style={{ maxWidth: '560px', margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <Eyebrow>Early access</Eyebrow>
          <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>Give your business an AI teammate.</h2>
          <p style={{ color: '#9ca3af', fontSize: '16px', marginTop: '12px' }}>Join the early-access list — we’re onboarding businesses in small batches.</p>
        </div>
        {wlState === 'done' ? (
          <div style={{ backgroundColor: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.35)', borderRadius: '16px', padding: '32px', textAlign: 'center' }}>
            <CheckCircle size={40} style={{ color: '#00ff87', marginBottom: '12px' }} />
            <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>You’re on the list! 🎉</h3>
            <p style={{ color: '#9ca3af', fontSize: '14px' }}>We’ll reach out at <strong style={{ color: '#00ff87' }}>{wlEmail}</strong> when your spot opens.</p>
          </div>
        ) : (
          <form onSubmit={submitWaitlist} style={{ display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: '#0d1117', border: '1px solid rgba(0,242,254,0.2)', borderRadius: '18px', padding: '28px' }}>
            <input type="email" required placeholder="you@business.com" value={wlEmail} onChange={(e) => setWlEmail(e.target.value)}
              style={{ padding: '14px 16px', borderRadius: '10px', backgroundColor: '#0b0e15', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: '15px', outline: 'none' }} />
            <select value={wlType} onChange={(e) => setWlType(e.target.value)}
              style={{ padding: '14px 16px', borderRadius: '10px', backgroundColor: '#0b0e15', border: '1px solid rgba(255,255,255,0.12)', color: wlType ? '#fff' : '#6b7280', fontSize: '15px', outline: 'none' }}>
              <option value="">Business type…</option>
              {AUDIENCE.map((a) => <option key={a.name} value={a.name} style={{ color: '#000' }}>{a.name}</option>)}
              <option value="Other" style={{ color: '#000' }}>Other</option>
            </select>
            {wlError && <div style={{ color: '#ff6b6b', fontSize: '13px' }}>{wlError}</div>}
            <button type="submit" disabled={wlState === 'submitting'} style={{ padding: '15px', borderRadius: '10px', background: 'linear-gradient(135deg,#00f2fe,#4facfe)', color: '#000', border: 'none', fontWeight: 800, fontSize: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {wlState === 'submitting' ? <><Loader size={16} className="spin" /> Joining…</> : <>Join Early Access <ArrowRight size={16} /></>}
            </button>
            <p style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center' }}>No spam. We’ll only email you about your early-access spot.</p>
          </form>
        )}
      </section>

      {/* ─── 12. Founder note ─── */}
      <section style={{ maxWidth: '720px', margin: '0 auto', padding: '20px 24px 90px' }}>
        <div style={{ backgroundColor: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '18px', padding: '34px', textAlign: 'center' }}>
          <div style={{ fontSize: '30px', marginBottom: '14px' }}>✍️</div>
          <p style={{ fontSize: '18px', lineHeight: 1.7, color: '#e9f0ff', fontStyle: 'italic' }}>
            “I’m building SaarthiOne because I believe small businesses deserve the same technology that large enterprises can afford.”
          </p>
          <div style={{ marginTop: '18px', fontSize: '13px', color: '#9ca3af', fontWeight: 600 }}>— The SaarthiOne founder</div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer style={{ backgroundColor: '#040609', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '50px 24px 40px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/logo-mark.svg" alt="SaarthiOne" width={28} height={28} style={{ borderRadius: '7px' }} />
            <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '18px' }}>Saarthi<span style={{ color: '#00f2fe' }}>One</span></span>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button onClick={() => scrollTo('waitlist')} style={{ padding: '11px 22px', borderRadius: '10px', background: 'linear-gradient(135deg,#00f2fe,#4facfe)', color: '#000', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>Get Early Access</button>
            <button onClick={onLaunchApp} style={{ padding: '11px 18px', borderRadius: '10px', backgroundColor: '#121620', color: '#f3f4f6', border: '1px solid rgba(255,255,255,0.15)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>Sign In</button>
          </div>
        </div>
        <div style={{ maxWidth: '1120px', margin: '30px auto 0', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.06)', color: '#6b7280', fontSize: '12px', textAlign: 'center' }}>
          © 2026 SaarthiOne · Your AI teammate for growing your business.
        </div>
      </footer>
    </div>
  );
}
