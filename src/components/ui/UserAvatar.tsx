import { useState, useEffect } from 'react'
import { useAvatar } from '@/context/AvatarContext'
import { cn, initials } from '@/lib/utils'

// Y3.1B §28 — shared by Sidebar, Topbar, and ProfileSettings so all three
// stay pixel-consistent and all read from the one AvatarProvider fetch
// (Y3.1B §32/§34) instead of each re-implementing their own
// image-or-initials markup.
interface UserAvatarProps {
  firstName: string
  lastName: string
  // 'sm' matches Sidebar/Topbar's existing 32×32 dimensions EXACTLY (both
  // already used `w-8 h-8` before this block — unchanged, no layout shift,
  // Y3.1B §28/§38). 'lg' is ProfileSettings' larger preview only.
  size?: 'sm' | 'lg'
  // Y3.1A-FIX1 §29 / Y3.1B §30 — per-surface, not one repeated string.
  // Sidebar/Topbar pass nothing (decorative — the name already renders as
  // text right next to it in both places); ProfileSettings passes a real,
  // descriptive alt for its larger, primary-content preview.
  alt?: string
  className?: string
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  sm: 'w-8 h-8 text-xs',
  lg: 'w-20 h-20 text-2xl',
}

export function UserAvatar({ firstName, lastName, size = 'sm', alt = '', className }: UserAvatarProps) {
  const { avatarUrl } = useAvatar()
  // Local, per-instance only — never reaches back into AvatarProvider state
  // (Y3.1B §29: "must not permanently corrupt AvatarProvider state from a
  // one-off rendering error"). Reset whenever the URL itself changes, so a
  // replacement image gets a fresh attempt rather than staying stuck on a
  // PREVIOUS image's load failure.
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [avatarUrl])

  const showImage = !!avatarUrl && !imgFailed

  return (
    <div
      className={cn(
        'rounded-full bg-blue-600 flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showImage ? (
        // object-cover + a square/circular container: the backend already
        // normalizes to a 512×512 center-cropped square, this is just
        // defensive CSS, not doing the cropping itself. onError sets local
        // state once and never re-attaches the same broken src, so there is
        // no retry loop and no native browser broken-image icon ever shows
        // (Y3.1B §29).
        <img
          src={avatarUrl}
          alt={alt}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span aria-hidden={alt === '' ? true : undefined}>{initials(firstName, lastName)}</span>
      )}
    </div>
  )
}
