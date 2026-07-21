-- Direct UPI collection (gateway-free): the merchant provides their own UPI VPA
-- and customers pay into it via a UPI intent link / QR. Unlike Razorpay UPI,
-- there is no automatic payment webhook, so these payments are confirmed
-- manually (the booking stays pending until the merchant marks it paid).

alter table public.organizations
  add column if not exists upi_vpa text,          -- e.g. merchant@okhdfcbank
  add column if not exists upi_payee_name text;   -- display name shown in the UPI app
