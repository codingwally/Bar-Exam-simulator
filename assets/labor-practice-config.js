/* Public endpoint only. Server credentials remain in Supabase Edge Function secrets. */
window.DueDiligenceLaborConfig = Object.freeze({
  endpoint: 'https://hbllomlijfznnuudpdvr.supabase.co/functions/v1/labor-practice',
  // Keep remote refresh disabled until the Edge Function and a validated Sheet snapshot
  // are deployed together. The page continues with its last available question catalog.
  remoteCatalogEnabled: false,
});
