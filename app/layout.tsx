import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'TherapAI — análise clínica automatizada para psicólogos',
  description: 'Toda sessão analisada. Memória longitudinal por paciente. Prontuário CFP estruturado automaticamente. Conversa com o caso ancorada nas suas próprias análises.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
