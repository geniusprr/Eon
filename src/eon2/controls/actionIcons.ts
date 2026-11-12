import { AppWindow, BookOpen, Calendar, Camera, Code2, Coffee, FileText, Folder, Gamepad2, Globe, Headphones, Heart, Image, Mail, Music, Settings2, Star, Terminal, Video, Zap, type LucideIcon } from 'lucide-react'
import type { ActionIconId } from '../../../shared/eon-controls'

export const actionIcons: Record<ActionIconId, { label: string; icon: LucideIcon }> = {
  app: { label: 'Uygulama', icon: AppWindow }, code: { label: 'Kod', icon: Code2 },
  globe: { label: 'İnternet', icon: Globe }, gamepad: { label: 'Oyun', icon: Gamepad2 },
  music: { label: 'Müzik', icon: Music }, video: { label: 'Video', icon: Video },
  camera: { label: 'Kamera', icon: Camera }, image: { label: 'Görsel', icon: Image },
  folder: { label: 'Klasör', icon: Folder }, file: { label: 'Dosya', icon: FileText },
  terminal: { label: 'Terminal', icon: Terminal }, settings: { label: 'Ayarlar', icon: Settings2 },
  star: { label: 'Yıldız', icon: Star }, heart: { label: 'Kalp', icon: Heart },
  zap: { label: 'Enerji', icon: Zap }, coffee: { label: 'Kahve', icon: Coffee },
  headphones: { label: 'Kulaklık', icon: Headphones }, mail: { label: 'E-posta', icon: Mail },
  calendar: { label: 'Takvim', icon: Calendar }, book: { label: 'Kitap', icon: BookOpen },
}
export function customActionIcon(id?: ActionIconId): LucideIcon | undefined {
  return id ? actionIcons[id]?.icon : undefined
}
