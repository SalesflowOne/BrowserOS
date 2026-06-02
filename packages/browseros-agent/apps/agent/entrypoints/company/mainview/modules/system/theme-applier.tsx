import { ThemeProvider } from 'next-themes'
import type { FC, ReactNode } from 'react'

export const ThemeApplier: FC<{ children: ReactNode }> = ({ children }) => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    {children}
  </ThemeProvider>
)
