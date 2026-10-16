#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey { Admin, Verifier(Address), Ticket(BytesN<32>) }

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TicketRecord {
    pub holder_hash: BytesN<32>,
    pub event_id: u32,
    pub status: u32, // 0=emitido, 1=usado, 2=cancelado
    pub issued_at: u64,
}

#[contract]
pub struct TicketRegistry;

#[contractimpl]
impl TicketRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) { panic!("already initialized"); }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Verifier(admin.clone()), &true);
    }

    pub fn set_verifier(env: Env, admin: Address, verifier: Address, allowed: bool) {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored { panic!("not admin"); }
        env.storage().persistent().set(&DataKey::Verifier(verifier), &allowed);
    }

    pub fn issue(env: Env, admin: Address, ticket_hash: BytesN<32>, holder_hash: BytesN<32>, event_id: u32) {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored { panic!("not admin"); }
        let key = DataKey::Ticket(ticket_hash.clone());
        if env.storage().persistent().has(&key) { panic!("ticket already exists"); }
        let record = TicketRecord { holder_hash, event_id, status: 0, issued_at: env.ledger().timestamp() };
        env.storage().persistent().set(&key, &record);
        env.events().publish((symbol_short!("issued"),), ticket_hash);
    }

    pub fn get_ticket(env: Env, ticket_hash: BytesN<32>) -> Option<TicketRecord> {
        env.storage().persistent().get(&DataKey::Ticket(ticket_hash))
    }

    pub fn use_ticket(env: Env, verifier: Address, ticket_hash: BytesN<32>) {
        verifier.require_auth();
        let allowed: bool = env.storage().persistent().get(&DataKey::Verifier(verifier)).unwrap_or(false);
        if !allowed { panic!("verifier not authorized"); }
        let key = DataKey::Ticket(ticket_hash.clone());
        let mut record: TicketRecord = env.storage().persistent().get(&key).expect("ticket not found");
        if record.status != 0 { panic!("ticket is not valid"); }
        record.status = 1;
        env.storage().persistent().set(&key, &record);
        env.events().publish((symbol_short!("used"),), ticket_hash);
    }

    pub fn cancel(env: Env, admin: Address, ticket_hash: BytesN<32>) {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored { panic!("not admin"); }
        let key = DataKey::Ticket(ticket_hash.clone());
        let mut record: TicketRecord = env.storage().persistent().get(&key).expect("ticket not found");
        if record.status != 0 { panic!("ticket cannot be cancelled"); }
        record.status = 2;
        env.storage().persistent().set(&key, &record);
        env.events().publish((symbol_short!("cancel"),), ticket_hash);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};
    #[test]
    fn issues_and_reads_ticket() {
        let env = Env::default(); let admin = Address::generate(&env);
        let id = env.register(TicketRegistry, ()); let client = TicketRegistryClient::new(&env, &id);
        env.mock_all_auths(); client.initialize(&admin);
        let ticket = BytesN::from_array(&env, &[1u8;32]);
        let holder = BytesN::from_array(&env, &[2u8;32]);
        client.issue(&admin, &ticket, &holder, &5);
        assert_eq!(client.get_ticket(&ticket).unwrap().event_id, 5);
    }
}
