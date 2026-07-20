import {
  OWEB_HIDE_BYOK,
  OWEB_PRODUCT_NAME,
} from './oweb-config'

export type ProductId = 'browseros' | 'oweb'

const rawProductId = import.meta.env.VITE_PRODUCT_ID?.trim()

export const PRODUCT_ID: ProductId =
  rawProductId === 'oweb' ? 'oweb' : 'browseros'

export const isOwebProduct = (): boolean => PRODUCT_ID === 'oweb'

export const productDisplayName = isOwebProduct()
  ? OWEB_PRODUCT_NAME
  : 'BrowserOS'

export const companyDisplayName = isOwebProduct() ? 'OWeb' : 'BrowserOS'

export const hideByok = isOwebProduct() ? OWEB_HIDE_BYOK : false

export const builtInProviderId = isOwebProduct() ? 'oweb' : 'browseros'

export const builtInProviderName = isOwebProduct() ? 'OWeb' : 'BrowserOS'

export const docsBaseUrl = isOwebProduct()
  ? 'https://oweb.one/docs'
  : 'https://docs.browseros.com'
