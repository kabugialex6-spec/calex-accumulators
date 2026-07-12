'use client';

import Link from 'next/link';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { Header } from '@/components/custom/header';
import { ThemeToggle } from '@/components/custom/theme-toggle';
import { Footer } from '@/components/custom/footer';
import { DigitPulsePanel } from '@/components/custom/digit-pulse-panel';

export default function DigitPulsePage() {
  const logoSrc = useLogoSrc();
  const { auth } = useDerivWSContext();
  const { authState, accounts, activeAccount, login, signUp, logout, switchAccount } = auth;

  return (
    <main className="flex flex-col bg-background max-lg:h-dvh max-lg:overflow-y-auto lg:min-h-dvh">
      <Header
        authState={authState}
        accounts={accounts}
        activeAccount={activeAccount}
        onLogin={login}
        onSignUp={signUp}
        onLogout={logout}
        onSwitchAccount={switchAccount}
        logoSrc={logoSrc}
        actions={<ThemeToggle />}
      />

      {/* Spacer to push content below fixed header — taller when authenticated (account bar visible) */}
      <div className={authState === 'authenticated' ? 'h-[76px] shrink-0' : 'h-[66px] shrink-0'} />

      <div className="flex-1 w-full max-w-7xl mx-auto px-3 py-4 sm:px-4 sm:py-6 pb-14">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <span className="text-base leading-none">←</span>
          <span>Back</span>
        </Link>

        <div className="mb-4">
          <h1 className="text-xl font-semibold text-foreground">Digit Pulse</h1>
          <p className="text-sm text-muted-foreground">
            Live last-digit frequency across synthetic indices. Read-only — no trades are placed
            from this page.
          </p>
        </div>

        <DigitPulsePanel />
      </div>

      <div className="py-4 text-center">
        <Footer />
      </div>
    </main>
  );
}
