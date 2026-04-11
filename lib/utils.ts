// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ##### END BACKEND #####
