import BrowserOSLogo from '@/assets/product_logo.svg'
import OWebLogo from '@/assets/oweb/product_logo.svg'
import { productDisplayName, isOwebProduct } from './product-config'

export const productLogo = isOwebProduct() ? OWebLogo : BrowserOSLogo

export const productLogoAlt = productDisplayName
