import React, { useState } from 'react';
import { 
  Bot, Sparkles, CheckCircle, ArrowRight, Play, 
  Lock, Users, ChevronRight, Compass, Utensils, Stethoscope, Scissors, GraduationCap, ShoppingBag,
  Eye, FileText, Activity
} from 'lucide-react';

interface LandingPageProps {
  onLaunchApp: () => void;
  onStartOnboarding: () => void;
}

export function LandingPage({ onLaunchApp, onStartOnboarding }: LandingPageProps) {
  const [selectedAgent, setSelectedAgent] = useState<string>('sales');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('travel');
  const [activeHeroTab, setActiveHeroTab] = useState<'summary' | 'demo'>('summary');

  const AI_EMPLOYEES = [
    {
      id: 'sales',
      title: 'Sales Agent',
      subtitle: 'Converts leads into paid customers',
      avatar: '💼',
      color: '#00f2fe',
      metrics: '3.4x higher lead conversion',
      messages: [
        { sender: 'customer', text: 'Hi, I want details about your Bali Honeymoon Package.' },
        { sender: 'agent', text: 'Hello! 👋 Our Bali Honeymoon Package (5N/6D, ₹49,999/person) includes a 4-Star Private Pool Villa in Seminyak, Nusa Penida tour, and candlelight dinner! Would you like me to reserve dates or send the itinerary?' },
        { sender: 'customer', text: 'Yes! Send me the itinerary for October 15.' },
        { sender: 'agent', text: 'Done! 📄 I have locked ₹49,999/person for Oct 15-20. Here is your instant booking link: pay.saarthione.ai/bk-9921' }
      ]
    },
    {
      id: 'support',
      title: 'Support Agent',
      subtitle: '24/7 instant resolution & policy search',
      avatar: '🎧',
      color: '#00ff87',
      metrics: '< 2-sec resolution time',
      messages: [
        { sender: 'customer', text: 'What is the visa policy and cancellation refund for Europe tour?' },
        { sender: 'agent', text: 'Schengen Visa requires application 45 days prior. Cancellations made 30+ days before departure receive a 90% refund! Would you like our visa concierge to assist with slot booking?' },
        { sender: 'customer', text: 'My flight got cancelled due to weather!' },
        { sender: 'agent', text: '🚨 Emergency detected. I am connecting you to senior agent Aarav right now with your booking history. Hang tight!' }
      ]
    },
    {
      id: 'booking',
      title: 'Booking Agent',
      subtitle: 'Slot selection & real-time reservations',
      avatar: '📅',
      color: '#4facfe',
      metrics: 'Zero double-bookings',
      messages: [
        { sender: 'customer', text: 'Do you have slots for Doctor Appointment tomorrow at 4 PM?' },
        { sender: 'agent', text: 'Dr. Sharma has a slot open tomorrow at 4:30 PM. Shall I confirm your consultation?' },
        { sender: 'customer', text: 'Yes, confirm 4:30 PM please.' },
        { sender: 'agent', text: '✅ Appointment Confirmed! Appointment ID: #CL-8842. Calendar invite sent to your WhatsApp.' }
      ]
    },
    {
      id: 'marketing',
      title: 'Marketing Agent',
      subtitle: 'Consent-safe broadcasts & re-engagement',
      avatar: '📢',
      color: '#feb47b',
      metrics: '68% WhatsApp open rate',
      messages: [
        { sender: 'agent', text: 'Hi Priya! 👋 You inquired about the Bali Package last week. We have 2 villa slots left for Diwali week at 15% off!' },
        { sender: 'customer', text: 'Is the 15% discount still valid?' },
        { sender: 'agent', text: 'Yes! Discount code DIVALI15 applied automatically. Valid for the next 2 hours.' }
      ]
    },
    {
      id: 'finance',
      title: 'Finance Agent',
      subtitle: 'Payment links, GST invoices & refunds',
      avatar: '💳',
      color: '#ff4e50',
      metrics: '₹74k recovered monthly',
      messages: [
        { sender: 'customer', text: 'Please send GST invoice for my booking #BK-9921.' },
        { sender: 'agent', text: 'Here is your official GST Tax Invoice #INV-2026-9921 (PDF). Amount Paid: ₹99,998.' }
      ]
    },
    {
      id: 'travel',
      title: 'Travel Agent',
      subtitle: 'Complete trip planning & itinerary concierge',
      avatar: '🌴',
      color: '#a855f7',
      metrics: 'Custom day-by-day plans',
      messages: [
        { sender: 'customer', text: 'Build me a 4-day Goa itinerary with water sports.' },
        { sender: 'agent', text: 'Here is your custom Goa plan! Day 1: Calangute Resort check-in + Sunset Cruise. Day 2: Parasailing & Jet Ski at Baga Beach. Day 3: Old Goa Heritage + Club Night. Day 4: Flea Market shopping & Departure.' }
      ]
    }
  ];

  const INDUSTRIES = [
    {
      id: 'travel',
      name: 'Travel & Tourism',
      icon: <Compass size={20} />,
      badge: 'Holiday Packages & Flight Concierge',
      sampleChat: [
        { sender: 'customer', text: 'Hi! Looking for a 6-day honeymoon in Bali under 1 Lakh.' },
        { sender: 'agent', text: "Congratulations! 🎉 For Bali in October, I recommend our 'Bali Romance Escape' (5N/6D, ₹49,999/person). Includes 4-Star Private Pool Villa, Nusa Penida tour, and romantic dinner." },
        { sender: 'customer', text: 'Can I add a floating breakfast to the villa?' },
        { sender: 'agent', text: 'Absolutely! Floating breakfast added for ₹2,500. Total package: ₹1,02,498 for 2 adults. Here is your payment link: pay.saarthione.ai/trv-bali' }
      ]
    },
    {
      id: 'restaurant',
      name: 'Restaurant & Dining',
      icon: <Utensils size={20} />,
      badge: 'Table Booking & Menu Ordering',
      sampleChat: [
        { sender: 'customer', text: 'Table for 4 people tonight at 8 PM at Olive Garden?' },
        { sender: 'agent', text: 'We have a outdoor terrace table available at 8:15 PM tonight. Shall I reserve it under your name?' },
        { sender: 'customer', text: 'Yes please. We also have 2 vegetarians.' },
        { sender: 'agent', text: 'Table Reserved! 🍽️ Confirmation #RES-441. Our Chef Special Jain & Vegan menu link has been attached!' }
      ]
    },
    {
      id: 'clinic',
      name: 'Clinic & Healthcare',
      icon: <Stethoscope size={20} />,
      badge: 'Doctor Appointment & Token Status',
      sampleChat: [
        { sender: 'customer', text: 'Need a dermatologist consultation appointment for tomorrow.' },
        { sender: 'agent', text: 'Dr. Ananya (Dermatology) is available tomorrow at 11:00 AM or 3:30 PM. Which slot suits you?' },
        { sender: 'customer', text: '11 AM works.' },
        { sender: 'agent', text: '✅ Confirmed! Token #14 for Dr. Ananya at 11:00 AM tomorrow. Please arrive 10 minutes prior. Clinic location: maps.app.goo.gl/clinic' }
      ]
    },
    {
      id: 'salon',
      name: 'Salon & Wellness',
      icon: <Scissors size={20} />,
      badge: 'Hair & Spa Slot Scheduling',
      sampleChat: [
        { sender: 'customer', text: 'Book hair spa and pedicure for Saturday 2 PM.' },
        { sender: 'agent', text: 'Saturday 2 PM is available with Senior Stylist Rahul! Total duration: 90 mins. Price: ₹2,499.' },
        { sender: 'customer', text: 'Confirm it!' },
        { sender: 'agent', text: 'Spa Slot Booked! 💆‍♀️ See you Saturday at 2:00 PM.' }
      ]
    },
    {
      id: 'education',
      name: 'Education & Academies',
      icon: <GraduationCap size={20} />,
      badge: 'Course Admissions & Prospectus',
      sampleChat: [
        { sender: 'customer', text: 'What is the fee structure for Full Stack Data Science Course?' },
        { sender: 'agent', text: 'Our 6-month Data Science Bootcamp is ₹45,000 (EMI options from ₹4,500/mo). Next batch starts August 1st! Download Prospectus PDF below.' },
        { sender: 'customer', text: 'Book a free demo class.' },
        { sender: 'agent', text: 'Demo Class Pass Issued! 🎓 Date: Saturday 5 PM on Zoom.' }
      ]
    },
    {
      id: 'retail',
      name: 'Retail & E-commerce',
      icon: <ShoppingBag size={20} />,
      badge: 'Product Check & Quick Checkout',
      sampleChat: [
        { sender: 'customer', text: 'Do you have Vitamin C Serum in stock?' },
        { sender: 'agent', text: 'Yes! GlowRoot Vitamin C Serum (₹1,299) is in stock with 24h express dispatch.' },
        { sender: 'customer', text: 'Send payment link.' },
        { sender: 'agent', text: '🛒 Click here to pay via UPI/Card: pay.saarthione.ai/order-991' }
      ]
    }
  ];

  const currentAgent = AI_EMPLOYEES.find(a => a.id === selectedAgent) || AI_EMPLOYEES[0]!;
  const currentIndustry = INDUSTRIES.find(i => i.id === selectedIndustry) || INDUSTRIES[0]!;

  return (
    <div className="landing-wrapper" style={{ backgroundColor: '#07090e', color: '#f3f4f6', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      
      {/* ─── 1. Header Navigation ────────────────────────────────────────── */}
      <nav style={{ 
        position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(16px)', 
        backgroundColor: 'rgba(9, 11, 15, 0.85)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div style={{ 
            width: '36px', height: '36px', borderRadius: '10px', 
            background: 'linear-gradient(135deg, #00f2fe, #4facfe)', 
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 15px rgba(0, 242, 254, 0.4)'
          }}>
            <Bot size={22} style={{ color: '#000' }} />
          </div>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '22px', letterSpacing: '-0.5px' }}>
            Saarthi<span style={{ color: '#00f2fe' }}>One</span>
          </span>
        </div>

        <div style={{ display: 'flex', gap: '32px', alignItems: 'center', fontSize: '14px', fontWeight: 500 }}>
          <a href="#hero-demo" style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>Live Demo</a>
          <a href="#ai-employees" style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>AI Employees</a>
          <a href="#industries" style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>Industries</a>
          <a href="#journey" style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>Why SaarthiOne</a>
          <a href="#architecture" style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>Architecture</a>
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button 
            onClick={onLaunchApp}
            style={{ 
              padding: '10px 18px', borderRadius: '10px', backgroundColor: '#1a1f2e', color: '#f3f4f6', 
              border: '1px solid rgba(255, 255, 255, 0.12)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' 
            }}
          >
            Launch Dashboard
          </button>
          <button 
            onClick={onStartOnboarding}
            style={{ 
              padding: '10px 20px', borderRadius: '10px', 
              background: 'linear-gradient(135deg, #00f2fe, #4facfe)', color: '#000', 
              border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
              boxShadow: '0 0 20px rgba(0, 242, 254, 0.3)' 
            }}
          >
            Get Started Free
          </button>
        </div>
      </nav>

      {/* ─── 2. Hero Section ────────────────────────────────────────────── */}
      <section id="hero-demo" style={{ 
        maxWidth: '1200px', margin: '0 auto', padding: '80px 24px 60px', 
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px', alignItems: 'center' 
      }}>
        <div>
          <div style={{ 
            display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '20px', 
            backgroundColor: 'rgba(0, 242, 254, 0.08)', border: '1px solid rgba(0, 242, 254, 0.25)', 
            color: '#00f2fe', fontSize: '12px', fontWeight: 600, marginBottom: '24px' 
          }}>
            <Sparkles size={14} />
            <span>AI-Native Business Operating System</span>
          </div>

          <h1 style={{ 
            fontSize: '52px', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-1.5px', 
            marginBottom: '20px', fontFamily: 'Outfit, sans-serif' 
          }}>
            Run your business through <br />
            <span style={{ 
              background: 'linear-gradient(135deg, #00f2fe, #4facfe, #00ff87)', 
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' 
            }}>
              AI-powered conversations.
            </span>
          </h1>

          <p style={{ fontSize: '18px', color: '#9ca3af', lineHeight: 1.6, marginBottom: '36px', maxWidth: '500px' }}>
            Your first AI employee. Ready in 5 minutes to acquire leads, book appointments, process payments, and support customers 24/7 on WhatsApp.
          </p>

          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '32px' }}>
            <button 
              onClick={onStartOnboarding}
              style={{ 
                padding: '16px 32px', borderRadius: '12px', 
                background: 'linear-gradient(135deg, #00f2fe, #4facfe)', color: '#000', 
                border: 'none', fontWeight: 700, fontSize: '15px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '10px',
                boxShadow: '0 0 25px rgba(0, 242, 254, 0.4)' 
              }}
            >
              <span>Get Started</span>
              <ArrowRight size={18} />
            </button>
            <button 
              onClick={onStartOnboarding}
              style={{ 
                padding: '16px 28px', borderRadius: '12px', backgroundColor: '#121620', color: '#f3f4f6', 
                border: '1px solid rgba(255, 255, 255, 0.15)', fontWeight: 600, fontSize: '15px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '10px' 
              }}
            >
              <Play size={16} style={{ color: '#00f2fe' }} />
              <span>Watch Demo</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#6b7280', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={16} style={{ color: '#00ff87' }} />
              <span>No coding required</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={16} style={{ color: '#00ff87' }} />
              <span>Official WhatsApp Cloud API</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={16} style={{ color: '#00ff87' }} />
              <span>5-min setup</span>
            </div>
          </div>
        </div>

        {/* Hero Interactive Phone Interface */}
        <div style={{ position: 'relative' }}>
          <div style={{ 
            position: 'absolute', inset: '-20px', borderRadius: '40px', 
            background: 'radial-gradient(circle, rgba(0, 242, 254, 0.15) 0%, transparent 70%)', 
            filter: 'blur(30px)', zIndex: 0 
          }} />

          <div style={{ 
            position: 'relative', zIndex: 1, backgroundColor: '#0f141c', 
            borderRadius: '24px', border: '1px solid rgba(0, 242, 254, 0.3)', 
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 242, 254, 0.1)',
            overflow: 'hidden'
          }}>
            {/* Phone Top Header */}
            <div style={{ 
              backgroundColor: '#161d2a', padding: '14px 20px', 
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ 
                  width: '38px', height: '38px', borderRadius: '50%', 
                  backgroundColor: 'rgba(0, 242, 254, 0.15)', border: '1px solid #00f2fe',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' 
                }}>
                  <Bot size={20} style={{ color: '#00f2fe' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>Saarthi AI (Employee #001)</div>
                  <div style={{ fontSize: '11px', color: '#00ff87', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00ff87' }} />
                    Active on WhatsApp Business
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', backgroundColor: 'rgba(255, 255, 255, 0.08)', color: '#9ca3af' }}>LIVE</span>
            </div>

            {/* Conversation Window */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '340px', backgroundColor: '#0b0e14' }}>
              
              {/* Saarthi Opening Speech */}
              <div style={{ 
                alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: '#18202c', 
                padding: '16px', borderRadius: '16px 16px 16px 4px', 
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '14px', lineHeight: 1.6, color: '#f3f4f6' }}>
                  Good morning. 👋<br /><br />
                  I'm <strong>Saarthi</strong>. Yesterday I:<br />
                  <span style={{ color: '#00ff87' }}>✓</span> answered <strong>126</strong> customer messages<br />
                  <span style={{ color: '#00ff87' }}>✓</span> booked <strong>8</strong> appointments<br />
                  <span style={{ color: '#00ff87' }}>✓</span> recovered <strong>₹74,000</strong> in abandoned sales<br />
                  <span style={{ color: '#00ff87' }}>✓</span> followed up with <strong>39</strong> leads<br /><br />
                  Would you like today's summary?
                </div>
                <div style={{ fontSize: '10px', color: '#6b7280', textAlign: 'right', marginTop: '8px' }}>08:30 AM</div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '4px 0' }}>
                <button 
                  onClick={() => setActiveHeroTab('summary')}
                  style={{ 
                    padding: '8px 14px', borderRadius: '20px', 
                    backgroundColor: activeHeroTab === 'summary' ? 'rgba(0, 242, 254, 0.2)' : '#121620', 
                    color: activeHeroTab === 'summary' ? '#00f2fe' : '#9ca3af',
                    border: activeHeroTab === 'summary' ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.1)',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer' 
                  }}
                >
                  ✓ Yes, show summary
                </button>
                <button 
                  onClick={() => setActiveHeroTab('demo')}
                  style={{ 
                    padding: '8px 14px', borderRadius: '20px', 
                    backgroundColor: activeHeroTab === 'demo' ? 'rgba(0, 242, 254, 0.2)' : '#121620', 
                    color: activeHeroTab === 'demo' ? '#00f2fe' : '#9ca3af',
                    border: activeHeroTab === 'demo' ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.1)',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer' 
                  }}
                >
                  📊 View Lead Funnel
                </button>
              </div>

              {/* Simulated Reply */}
              {activeHeroTab === 'summary' && (
                <>
                  <div style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: '#005c4b', padding: '12px 16px', borderRadius: '16px 16px 4px 16px', color: '#fff', fontSize: '13px' }}>
                    Yes, show today's summary!
                  </div>
                  <div style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: '#18202c', padding: '14px 16px', borderRadius: '16px 16px 16px 4px', border: '1px solid rgba(0, 242, 254, 0.2)', fontSize: '13px', lineHeight: 1.5 }}>
                    📈 <strong>Today's Live Pulse:</strong><br />
                    • 12 new qualified leads added to CRM<br />
                    • 3 Bali Packages booked (₹1,49,997 collected)<br />
                    • 0 policy or safety violations detected
                  </div>
                </>
              )}

              {activeHeroTab === 'demo' && (
                <>
                  <div style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: '#005c4b', padding: '12px 16px', borderRadius: '16px 16px 4px 16px', color: '#fff', fontSize: '13px' }}>
                    Show me the Lead Funnel
                  </div>
                  <div style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: '#18202c', padding: '14px 16px', borderRadius: '16px 16px 16px 4px', border: '1px solid rgba(0, 242, 254, 0.2)', fontSize: '13px', lineHeight: 1.5 }}>
                    🎯 <strong>Active CRM Funnel:</strong><br />
                    • New Inquiries: 45<br />
                    • Qualified Quotes: 32<br />
                    • Booking Confirmed: 18<br />
                    • Payments Received: 14
                  </div>
                </>
              )}

            </div>

            {/* Bottom Subtext Banner */}
            <div style={{ padding: '12px 20px', backgroundColor: '#121722', borderTop: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'center', fontSize: '12px', color: '#00f2fe', fontWeight: 600 }}>
              "This isn't another CRM. It's your AI Business OS."
            </div>
          </div>
        </div>
      </section>

      {/* ─── 3. AI Employees Section ────────────────────────────────────── */}
      <section id="ai-employees" style={{ maxWidth: '1200px', margin: '0 auto', padding: '80px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '60px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
            Meet Your New Workforce
          </div>
          <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '16px' }}>
            AI Employees. Not feature cards.
          </h2>
          <p style={{ color: '#9ca3af', fontSize: '16px', maxWidth: '600px', margin: '0 auto' }}>
            Deploy specialized, autonomous AI employees trained for specific roles in your business.
          </p>
        </div>

        {/* Employee Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '40px' }}>
          {AI_EMPLOYEES.map(emp => (
            <div 
              key={emp.id}
              onClick={() => setSelectedAgent(emp.id)}
              style={{ 
                backgroundColor: selectedAgent === emp.id ? 'rgba(0, 242, 254, 0.06)' : '#0d1117', 
                borderRadius: '16px', padding: '24px', 
                border: selectedAgent === emp.id ? `2px solid ${emp.color}` : '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer', transition: 'all 0.2s ease',
                boxShadow: selectedAgent === emp.id ? `0 0 20px ${emp.color}25` : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <span style={{ fontSize: '32px' }}>{emp.avatar}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', backgroundColor: 'rgba(255, 255, 255, 0.08)', color: emp.color }}>
                  {emp.metrics}
                </span>
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px', color: '#fff' }}>{emp.title}</h3>
              <p style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.4 }}>{emp.subtitle}</p>
            </div>
          ))}
        </div>

        {/* Active Employee Conversation Preview */}
        <div style={{ 
          backgroundColor: '#0f141d', borderRadius: '20px', border: `1px solid ${currentAgent.color}40`, 
          padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '40px', alignItems: 'center' 
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span style={{ fontSize: '36px' }}>{currentAgent.avatar}</span>
              <div>
                <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }}>{currentAgent.title}</h3>
                <span style={{ fontSize: '13px', color: currentAgent.color, fontWeight: 600 }}>Active & Trained</span>
              </div>
            </div>
            <p style={{ color: '#9ca3af', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
              {currentAgent.subtitle}. Works continuously through Meta Business Agents API without manual intervention.
            </p>
            <button 
              onClick={onStartOnboarding}
              style={{ 
                padding: '12px 24px', borderRadius: '10px', backgroundColor: currentAgent.color, 
                color: '#000', fontWeight: 700, fontSize: '13px', border: 'none', cursor: 'pointer' 
              }}
            >
              Hire This AI Employee
            </button>
          </div>

          <div style={{ backgroundColor: '#090c12', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {currentAgent.messages.map((m, idx) => (
              <div 
                key={idx}
                style={{ 
                  alignSelf: m.sender === 'customer' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  backgroundColor: m.sender === 'customer' ? '#005c4b' : '#1a212d',
                  color: '#fff',
                  padding: '10px 14px',
                  borderRadius: m.sender === 'customer' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  fontSize: '13px',
                  lineHeight: 1.4
                }}
              >
                {m.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 4. Industries Section ──────────────────────────────────────── */}
      <section id="industries" style={{ backgroundColor: '#0a0d14', padding: '80px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '50px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              Tailored Industry Intelligence
            </div>
            <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '16px' }}>
              Built for your industry out of the box.
            </h2>
            <p style={{ color: '#9ca3af', fontSize: '16px' }}>
              Not generic responses — actual industry workflows, catalog schemas, and compliance bounds.
            </p>
          </div>

          {/* Industry Tabs */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '40px' }}>
            {INDUSTRIES.map(ind => (
              <button 
                key={ind.id}
                onClick={() => setSelectedIndustry(ind.id)}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px', 
                  borderRadius: '12px', backgroundColor: selectedIndustry === ind.id ? '#00f2fe' : '#121620', 
                  color: selectedIndustry === ind.id ? '#000' : '#9ca3af',
                  fontWeight: selectedIndustry === ind.id ? 700 : 500, fontSize: '14px',
                  border: selectedIndustry === ind.id ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                  cursor: 'pointer', transition: 'all 0.2s ease'
                }}
              >
                {ind.icon}
                <span>{ind.name}</span>
              </button>
            ))}
          </div>

          {/* Active Industry Conversation Demo */}
          <div style={{ 
            backgroundColor: '#0d1118', borderRadius: '20px', border: '1px solid rgba(0, 242, 254, 0.2)', 
            padding: '36px', maxWidth: '800px', margin: '0 auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#00ff87' }} />
                <span style={{ fontWeight: 700, fontSize: '16px' }}>{currentIndustry.name} Live WhatsApp Stream</span>
              </div>
              <span style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '12px', backgroundColor: 'rgba(0, 242, 254, 0.1)', color: '#00f2fe', fontWeight: 600 }}>
                {currentIndustry.badge}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {currentIndustry.sampleChat.map((chat, idx) => (
                <div 
                  key={idx}
                  style={{ 
                    alignSelf: chat.sender === 'customer' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    backgroundColor: chat.sender === 'customer' ? '#005c4b' : '#1c2433',
                    color: '#fff',
                    padding: '12px 18px',
                    borderRadius: chat.sender === 'customer' ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                    fontSize: '14px',
                    lineHeight: 1.5,
                    border: chat.sender === 'agent' ? '1px solid rgba(255, 255, 255, 0.05)' : 'none'
                  }}
                >
                  {chat.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── 5. Why SaarthiOne (The Uninterrupted Journey) ─────────────── */}
      <section id="journey" style={{ maxWidth: '1200px', margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '60px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
            Why SaarthiOne
          </div>
          <h2 style={{ fontSize: '42px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '16px' }}>
            One uninterrupted journey.
          </h2>
          <p style={{ color: '#9ca3af', fontSize: '16px', maxWidth: '600px', margin: '0 auto' }}>
            Instead of piecing together CRM, scheduling, and payment links, SaarthiOne handles the entire customer lifecycle in a single WhatsApp thread.
          </p>
        </div>

        {/* Journey Flow Steps */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', overflowX: 'auto', paddingBottom: '20px' }}>
          {[
            { step: '01', title: 'Lead', desc: 'Inbound WhatsApp / IG inquiry captured' },
            { step: '02', title: 'Conversation', desc: 'AI qualifies interest & answers queries' },
            { step: '03', title: 'Booking', desc: 'Package or slot reserved in real-time' },
            { step: '04', title: 'Payment', desc: 'Instant Razorpay / Stripe checkout link' },
            { step: '05', title: 'Customer', desc: 'Automated receipt & voucher dispatch' },
            { step: '06', title: 'Loyalty', desc: 'Consent-safe re-engagement & reviews' }
          ].map((item, index, arr) => (
            <React.Fragment key={item.step}>
              <div style={{ 
                flex: 1, minWidth: '150px', backgroundColor: '#0e131d', 
                borderRadius: '16px', padding: '24px 16px', textAlign: 'center',
                border: '1px solid rgba(0, 242, 254, 0.2)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)'
              }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#00f2fe', marginBottom: '8px' }}>{item.step}</div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>{item.title}</h3>
                <p style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>{item.desc}</p>
              </div>
              {index < arr.length - 1 && (
                <ChevronRight size={24} style={{ color: '#00f2fe', flexShrink: 0 }} />
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ─── 6. Trust & Safety Section ──────────────────────────────────── */}
      <section id="trust" style={{ backgroundColor: '#090d15', padding: '80px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#00ff87', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              Enterprise Governance
            </div>
            <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '16px' }}>
              This is where we differentiate.
            </h2>
            <p style={{ color: '#9ca3af', fontSize: '16px' }}>
              Every AI action is bounded, explainable, and guarded by deterministic safety gates.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
            {[
              { icon: <Activity size={24} />, title: 'Traceable', desc: 'Full OpenTelemetry tracing for every LLM token & tool call' },
              { icon: <Eye size={24} />, title: 'Explainable', desc: 'Transparent policy decision logs for why actions were taken' },
              { icon: <FileText size={24} />, title: 'Auditable', desc: 'Immutable append-only audit log table protected by DB triggers' },
              { icon: <Users size={24} />, title: 'Human Override', desc: 'Instant 1-click escalation to operator inbox when requested' },
              { icon: <Lock size={24} />, title: 'Secure', desc: 'Supabase Row-Level Security (RLS) tenant isolation on all tables' }
            ].map((t, idx) => (
              <div key={idx} style={{ backgroundColor: '#101622', borderRadius: '16px', padding: '24px', border: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'center' }}>
                <div style={{ color: '#00ff87', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>{t.icon}</div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>✓ {t.title}</h3>
                <p style={{ fontSize: '12px', color: '#9ca3af', lineHeight: 1.4 }}>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 7. Architecture & Stack ("Powered by") ──────────────────────── */}
      <section id="architecture" style={{ maxWidth: '1200px', margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '50px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
            Technical Architecture
          </div>
          <h2 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '16px' }}>
            Powered by industry leaders.
          </h2>
          <p style={{ color: '#9ca3af', fontSize: '16px' }}>
            Built on top of foundation models and Meta's official Cloud Messaging infrastructure.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          {[
            { title: 'Meta Cloud API', category: 'Messaging Engine', desc: 'Official WhatsApp Business & Instagram Graph API' },
            { title: 'GPT-4o / Claude 3.5', category: 'LLM Gateway', desc: 'Multi-provider routing with fallback & cost tracking' },
            { title: 'Grounded RAG Search', category: 'Knowledge Engine', desc: '1536d Cosine similarity search with similarity thresholds' },
            { title: 'Agentic Workflows', category: 'LangGraph Mesh', desc: 'Coordinator & Specialist multi-agent orchestrator' }
          ].map((tech, idx) => (
            <div key={idx} style={{ backgroundColor: '#0d1117', borderRadius: '16px', padding: '24px', border: '1px solid rgba(0, 242, 254, 0.2)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase', marginBottom: '6px' }}>{tech.category}</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>{tech.title}</h3>
              <p style={{ fontSize: '12px', color: '#9ca3af', lineHeight: 1.4 }}>{tech.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 8. Final Conversion CTA Footer ─────────────────────────────── */}
      <footer style={{ backgroundColor: '#040609', borderTop: '1px solid rgba(255, 255, 255, 0.08)', padding: '80px 24px 40px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '42px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', marginBottom: '16px' }}>
            Your first AI employee. <br />
            <span style={{ color: '#00f2fe' }}>Ready in 5 minutes.</span>
          </h2>
          <p style={{ color: '#9ca3af', fontSize: '16px', marginBottom: '32px' }}>
            Join forward-thinking travel agencies, restaurants, and SMBs running their business through AI conversations.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '60px' }}>
            <button 
              onClick={onStartOnboarding}
              style={{ 
                padding: '16px 36px', borderRadius: '12px', 
                background: 'linear-gradient(135deg, #00f2fe, #4facfe)', color: '#000', 
                border: 'none', fontWeight: 800, fontSize: '16px', cursor: 'pointer',
                boxShadow: '0 0 30px rgba(0, 242, 254, 0.4)' 
              }}
            >
              Get Started Free
            </button>
            <button 
              onClick={onLaunchApp}
              style={{ 
                padding: '16px 28px', borderRadius: '12px', backgroundColor: '#121620', color: '#f3f4f6', 
                border: '1px solid rgba(255, 255, 255, 0.15)', fontWeight: 600, fontSize: '15px', cursor: 'pointer' 
              }}
            >
              Open Dashboard
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#6b7280', fontSize: '12px' }}>
            <div>© 2026 SaarthiOne Inc. All rights reserved.</div>
            <div style={{ display: 'flex', gap: '20px' }}>
              <span>Privacy Policy</span>
              <span>Terms of Service</span>
              <span>Security</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
