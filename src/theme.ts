export const APP_THEMES = ['light', 'obsidian', 'rose', 'violet', 'ocean'] as const
export type AppTheme = typeof APP_THEMES[number]

export const DEFAULT_APP_THEME: AppTheme = 'obsidian'

export const APP_THEME_STORAGE_KEY = 'kapanis_app_theme'

export function isAppTheme(value: string | null): value is AppTheme {
  return APP_THEMES.some(theme => theme === value)
}

export function themeColorScheme(theme: AppTheme): 'light' | 'dark' {
  return theme === 'light' ? 'light' : 'dark'
}
