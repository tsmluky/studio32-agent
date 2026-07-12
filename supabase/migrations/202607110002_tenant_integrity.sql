-- Prevent accidental cross-organization relationships at the database layer.

alter table public.channel_accounts add constraint channel_accounts_org_id_unique unique (organization_id, id);
alter table public.contacts add constraint contacts_org_id_unique unique (organization_id, id);
alter table public.conversations add constraint conversations_org_id_unique unique (organization_id, id);
alter table public.services add constraint services_org_id_unique unique (organization_id, id);

alter table public.conversations
  add constraint conversations_channel_same_org
  foreign key (organization_id, channel_account_id)
  references public.channel_accounts (organization_id, id);

alter table public.conversations
  add constraint conversations_contact_same_org
  foreign key (organization_id, contact_id)
  references public.contacts (organization_id, id);

alter table public.messages
  add constraint messages_conversation_same_org
  foreign key (organization_id, conversation_id)
  references public.conversations (organization_id, id);

alter table public.appointments
  add constraint appointments_contact_same_org
  foreign key (organization_id, contact_id)
  references public.contacts (organization_id, id);

alter table public.appointments
  add constraint appointments_conversation_same_org
  foreign key (organization_id, conversation_id)
  references public.conversations (organization_id, id);

alter table public.appointments
  add constraint appointments_service_same_org
  foreign key (organization_id, service_id)
  references public.services (organization_id, id);

alter table public.leads
  add constraint leads_contact_same_org
  foreign key (organization_id, contact_id)
  references public.contacts (organization_id, id);

alter table public.leads
  add constraint leads_conversation_same_org
  foreign key (organization_id, conversation_id)
  references public.conversations (organization_id, id);

alter table public.handoffs
  add constraint handoffs_conversation_same_org
  foreign key (organization_id, conversation_id)
  references public.conversations (organization_id, id);
