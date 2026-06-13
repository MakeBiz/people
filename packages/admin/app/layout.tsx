import type { Metadata } from "next";
import { Oxygen } from "next/font/google";
import "./globals.css";

// Фирменный шрифт MakeBiz. Oxygen покрывает латиницу; кириллица — системный fallback.
const oxygen = Oxygen({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "700"],
  variable: "--font-oxygen",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MakeBiz — HR-тестирование",
  description: "Платформа психологического тестирования сотрудников",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={oxygen.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
