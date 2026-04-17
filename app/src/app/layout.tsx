import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/providers/WalletProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Editorial serif for hero + closer blockquote. Paired against the mono
// data type to create a sans/serif/mono typographic triangle — gives the
// landing an editorial/institutional weight that generic web3 UIs lack.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShadowPool — Confidential Execution Layer for Solana",
  description:
    "The dark-pool execution layer for Solana. Encrypted strategy, public execution, selective disclosure for auditors. Built on Arcium MPC.",
  // `opengraph-image.tsx` + `twitter-image.tsx` are picked up
  // automatically by Next 16 at the app/ root. Explicit metadata
  // below ensures the `og:` / `twitter:` fields are populated even
  // if the image files are temporarily absent during CI runs.
  openGraph: {
    title: "ShadowPool — Confidential Execution Layer for Solana",
    description:
      "Dark-pool execution for Solana. Strategy lives inside Arcium's MPC cluster; only quotes reach the chain.",
    type: "website",
    locale: "en_US",
    siteName: "ShadowPool",
  },
  twitter: {
    card: "summary_large_image",
    title: "ShadowPool — Confidential Execution Layer for Solana",
    description:
      "Dark-pool execution for Solana. Strategy lives inside Arcium's MPC cluster; only quotes reach the chain.",
    creator: "@criptocbas",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-full">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
