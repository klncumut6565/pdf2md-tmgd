import './globals.css';

export const metadata = {
  title: 'PDF → MD | TMGD Doküman Dönüştürücü',
  description: 'PDF belgelerini Claude için token-verimli Markdown formatına dönüştürür.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
