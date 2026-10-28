-- Separate synthetic-only intake. Does not modify any legacy table, grant or RPC.
CREATE TABLE public.website_intake_synthetic_events (
  event_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at timestamptz,
  CHECK (jsonb_typeof(payload) = 'object' AND payload ?& ARRAY['eventId','synthetic','name','email','workflow','resourceId'] AND payload - ARRAY['eventId','synthetic','name','email','workflow','resourceId'] = '{}'::jsonb),
  CHECK (jsonb_typeof(payload->'eventId')='string' AND payload->>'eventId' = event_id::text AND payload->'synthetic' = 'true'::jsonb),
  CHECK (jsonb_typeof(payload->'email')='string' AND payload->>'email' ~ '^pilot-[a-z0-9-]{1,50}@intake[.]invalid$'),
  CHECK (jsonb_typeof(payload->'name')='string' AND payload->>'name' ~ '^PILOT TEST [A-Za-z0-9 -]{1,60}$'),
  CHECK (jsonb_typeof(payload->'resourceId')='string' AND payload->>'resourceId' ~ '^PILOT-[A-Z0-9-]{1,40}$'),
  CHECK (jsonb_typeof(payload->'workflow')='string' AND payload->>'workflow' IN ('service','class','partner','college','investor'))
);
CREATE INDEX website_intake_synthetic_pending ON public.website_intake_synthetic_events (created_at, event_id) WHERE acknowledged_at IS NULL;
CREATE TABLE public.website_intake_synthetic_rate (
  bucket timestamptz PRIMARY KEY,
  accepted integer NOT NULL CHECK (accepted BETWEEN 1 AND 20)
);
CREATE TABLE public.website_intake_synthetic_nonces (
  nonce uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.website_intake_synthetic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_intake_synthetic_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_intake_synthetic_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_intake_synthetic_events, public.website_intake_synthetic_rate, public.website_intake_synthetic_nonces FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.website_intake_synthetic_events TO service_role;
GRANT UPDATE(acknowledged_at) ON public.website_intake_synthetic_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_intake_synthetic_rate, public.website_intake_synthetic_nonces TO service_role;

CREATE FUNCTION public.website_intake_synthetic_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Immutable synthetic intake event'; END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at)
  THEN RAISE EXCEPTION 'Immutable synthetic intake event'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.website_intake_synthetic_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_intake_synthetic_immutable() TO service_role;
CREATE TRIGGER website_intake_synthetic_immutable BEFORE UPDATE OR DELETE ON public.website_intake_synthetic_events FOR EACH ROW EXECUTE FUNCTION public.website_intake_synthetic_immutable();

CREATE FUNCTION public.website_intake_synthetic_capture(p_event_id uuid, p_payload jsonb, p_payload_hash text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE existing_hash text; minute_bucket timestamptz; accepted_count integer; canonical_payload text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7031927);
  canonical_payload := '{"eventId":'||(p_payload->'eventId')::text||',"synthetic":true,"name":'||(p_payload->'name')::text||',"email":'||(p_payload->'email')::text||',"workflow":'||(p_payload->'workflow')::text||',"resourceId":'||(p_payload->'resourceId')::text||'}';
  IF p_payload_hash IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(canonical_payload,'UTF8')),'hex') THEN RETURN 'invalid'; END IF;
  SELECT payload_hash INTO existing_hash FROM public.website_intake_synthetic_events WHERE event_id = p_event_id;
  IF FOUND THEN
    IF existing_hash = p_payload_hash AND EXISTS(SELECT 1 FROM public.website_intake_synthetic_events WHERE event_id=p_event_id AND payload=p_payload) THEN RETURN 'duplicate'; END IF;
    RETURN 'collision';
  END IF;
  minute_bucket := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  DELETE FROM public.website_intake_synthetic_rate WHERE bucket < minute_bucket - INTERVAL '10 minutes';
  SELECT accepted INTO accepted_count FROM public.website_intake_synthetic_rate WHERE bucket=minute_bucket;
  IF accepted_count >= 20 THEN RETURN 'rate_limited'; END IF;
  INSERT INTO public.website_intake_synthetic_events(event_id,payload,payload_hash) VALUES(p_event_id,p_payload,p_payload_hash);
  INSERT INTO public.website_intake_synthetic_rate(bucket,accepted) VALUES(minute_bucket,1)
    ON CONFLICT(bucket) DO UPDATE SET accepted=public.website_intake_synthetic_rate.accepted+1;
  RETURN 'inserted';
END $$;

CREATE FUNCTION public.website_intake_synthetic_exchange(p_nonce uuid, p_operation text, p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE out_events jsonb; supplied_count integer; matched_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7031927);
  DELETE FROM public.website_intake_synthetic_nonces WHERE received_at < pg_catalog.clock_timestamp() - INTERVAL '10 minutes';
  INSERT INTO public.website_intake_synthetic_nonces(nonce) VALUES(p_nonce) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','replay'); END IF;
  IF p_operation='pull' AND p_events='[]'::jsonb THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',event_id,'payloadHash',payload_hash,'payload',payload) ORDER BY created_at,event_id),'[]'::jsonb)
    INTO out_events FROM (SELECT * FROM public.website_intake_synthetic_events WHERE acknowledged_at IS NULL ORDER BY created_at,event_id LIMIT 20) pending;
    RETURN jsonb_build_object('events',out_events);
  END IF;
  IF p_operation <> 'ack' OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 20 THEN RETURN jsonb_build_object('error','invalid'); END IF;
  supplied_count := jsonb_array_length(p_events);
  SELECT count(DISTINCT e.event_id) INTO matched_count FROM public.website_intake_synthetic_events e
    JOIN jsonb_to_recordset(p_events) AS a("eventId" uuid,"payloadHash" text) ON e.event_id=a."eventId" AND e.payload_hash=a."payloadHash";
  IF supplied_count <> matched_count THEN RETURN jsonb_build_object('error','collision'); END IF;
  UPDATE public.website_intake_synthetic_events e SET acknowledged_at=coalesce(e.acknowledged_at,pg_catalog.clock_timestamp())
    FROM jsonb_to_recordset(p_events) AS a("eventId" uuid,"payloadHash" text) WHERE e.event_id=a."eventId" AND e.payload_hash=a."payloadHash";
  RETURN jsonb_build_object('acknowledged',matched_count);
END $$;
REVOKE ALL ON FUNCTION public.website_intake_synthetic_capture(uuid,jsonb,text), public.website_intake_synthetic_exchange(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_intake_synthetic_capture(uuid,jsonb,text), public.website_intake_synthetic_exchange(uuid,text,jsonb) TO service_role;
