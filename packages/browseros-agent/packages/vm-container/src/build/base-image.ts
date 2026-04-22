import type { Arch } from '../schema/arch'

export interface BaseImage {
  distro: 'debian'
  release: string
  channel: 'genericcloud'
  upstreamVersion: string
  arch: Arch
  url: string
  sha512: string
}

// Debian bookworm genericcloud snapshot pin. Bump by hand when a newer
// daily is needed; the scheduled base-image-bump workflow (follow-up PR)
// will automate it. Pins are the SHA-512 values from the snapshot's
// SHA512SUMS file at https://cloud.debian.org/images/cloud/bookworm/.
// Debian publishes SHA512SUMS for these snapshots, not SHA256SUMS.
const BOOKWORM_VERSION = '20260413-2447'

const PINNED_SHA512: Record<Arch, string> = {
  arm64:
    '15ad6c52e255c84eb0e91001c5907b27199d8a7164d8ac172cfe9c92850dfaf606a6c3161d6af7f0fd5a5fef2aa8dcd9a23c2eb0fedbfcddb38e2bc306cba98f',
  x64: 'db11b13c4efcc37828ffadae521d101e85079d349e1418074087bb7d306f11caccdc2b0b539d6fd50d623d40a898f83c6137268a048d7700397dc35b7dcbc927',
}

export const DEBIAN_BASE_IMAGES: Record<Arch, BaseImage> = {
  arm64: {
    distro: 'debian',
    release: 'bookworm',
    channel: 'genericcloud',
    upstreamVersion: BOOKWORM_VERSION,
    arch: 'arm64',
    url: `https://cloud.debian.org/images/cloud/bookworm/${BOOKWORM_VERSION}/debian-12-genericcloud-arm64-${BOOKWORM_VERSION}.qcow2`,
    sha512: PINNED_SHA512.arm64,
  },
  x64: {
    distro: 'debian',
    release: 'bookworm',
    channel: 'genericcloud',
    upstreamVersion: BOOKWORM_VERSION,
    arch: 'x64',
    url: `https://cloud.debian.org/images/cloud/bookworm/${BOOKWORM_VERSION}/debian-12-genericcloud-amd64-${BOOKWORM_VERSION}.qcow2`,
    sha512: PINNED_SHA512.x64,
  },
}

export const debianSha512SumsUrl = (upstreamVersion: string): string =>
  `https://cloud.debian.org/images/cloud/bookworm/${upstreamVersion}/SHA512SUMS`
