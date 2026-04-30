-- =============================================
-- Migration: Create user_companies junction table
-- Purpose: Support multi-company user assignments
-- =============================================

-- Create the junction table
CREATE TABLE IF NOT EXISTS public.user_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id)
);

-- Enable RLS
ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access" ON public.user_companies
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_user_companies_user_id ON public.user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company_id ON public.user_companies(company_id);

-- Migrate existing data from users.company_id to user_companies
INSERT INTO public.user_companies (user_id, company_id)
SELECT id, company_id
FROM public.users
WHERE company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_companies uc 
    WHERE uc.user_id = public.users.id 
    AND uc.company_id = public.users.company_id
  )
ON CONFLICT (user_id, company_id) DO NOTHING;

-- Also migrate from supervisor_companies if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supervisor_companies') THEN
    INSERT INTO public.user_companies (user_id, company_id)
    SELECT user_id, company_id FROM public.supervisor_companies
    ON CONFLICT (user_id, company_id) DO NOTHING;
  END IF;
END $$;
