use std::marker::PhantomData;

use rspc::{
    procedure::{Procedure, ProcedureBuilder, ResolverInput, ResolverOutput},
    Infallible,
};

#[derive(Clone)]
pub struct Context {}

pub type Router = rspc::Router<Context>;

pub struct BaseProcedure<TErr = Infallible>(PhantomData<TErr>);

impl<TErr> BaseProcedure<TErr> {
    pub fn builder<TInput, TResult>() -> ProcedureBuilder<TErr, Context, Context, TInput, TResult>
    where
        TErr: rspc::Error,
        TInput: ResolverInput,
        TResult: ResolverOutput<TErr>,
    {
        Procedure::builder()
    }

    // TODO: Auth
}
