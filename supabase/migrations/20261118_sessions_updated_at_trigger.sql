-- Her UPDATE'te updated_at'i tazele: admin log listesi "son aktivite"
-- sirasina gore dizilir (en son form girilen log en ustte).
-- Not: pending session'larin devralinabilirlik filtresi de updated_at'i
-- kullandigi icin aktif kullanicinin session'i yanlislikla baskasina devredilmez.

CREATE OR REPLACE FUNCTION public.set_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON public.sessions;
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sessions_updated_at();
