import { redirect } from 'next/navigation'

export default function ElectriciansPostcardRedirect() {
  redirect('/electricians?utm_source=postcard&utm_medium=direct_mail&utm_campaign=electricians_lm_2026_q2&utm_content=qr_code')
}
