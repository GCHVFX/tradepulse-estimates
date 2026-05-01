import { redirect } from 'next/navigation'

export default function TradesPostcardRedirect() {
  redirect('/trades?utm_source=postcard&utm_medium=direct_mail&utm_campaign=trades_lm_2026_q2&utm_content=qr_code')
}
