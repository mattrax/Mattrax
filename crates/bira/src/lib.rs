//! Better derive macro for automatically implementing builder syntax

use proc_macro::TokenStream;
use quote::{format_ident, quote, ToTokens};
use syn::{parse_macro_input, spanned::Spanned, Data, DeriveInput, Type};

#[proc_macro_derive(Builder)]
pub fn builder_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match inner(input) {
        Ok(t) => t,
        Err(e) => e.into_compile_error().into(),
    }
}

fn inner(input: DeriveInput) -> Result<TokenStream, syn::Error> {
    let ident = input.ident;
    let builder_ident = format_ident!("{ident}Builder");

    let s = match input.data {
        Data::Struct(s) => s,
        Data::Enum(_) => Err(syn::Error::new(ident.span(), "Enums are not supported"))?,
        Data::Union(_) => Err(syn::Error::new(ident.span(), "Unions are not supported"))?,
    };

    let fields = s
        .fields
        .into_iter()
        .map(|field| {
            let ident = field.ident.as_ref().ok_or(syn::Error::new(
                field.span(),
                "Unnamed fields in structs are not supported",
            ))?;
            let option_inner_ty = extract_option_value(&field.ty);

            let (ty, setter) = if let Some(ty) = option_inner_ty {
                (quote!(#ty), quote!(Some(value)))
            } else {
                let ty = &field.ty;
                (quote!(#ty), quote!(value))
            };

            let ident_mut = format_ident!("{ident}mut");
            let setter = quote! {
                pub fn #ident(mut self, value: #ty) -> Self {
                    self.0.#ident = #setter;
                    self
                }

                // pub fn #ident_mut(mut self, value: #field.ty) -> Self { // TODO
            };

            Ok((
                setter,
                if option_inner_ty.is_some() {
                    (quote!(#ident: None), quote!())
                } else {
                    let ty = &field.ty;
                    (quote!(#ident: #ident), quote!(#ident: #ty,))
                },
            ))
        })
        .collect::<Result<Vec<_>, syn::Error>>()?;

    let (setter, extras): (Vec<_>, Vec<_>) = fields.into_iter().unzip();
    let (decl, arg): (Vec<_>, Vec<_>) = extras.into_iter().unzip();

    let module_ident = format_ident!("___bira_{ident}");
    Ok(quote! {
        mod #module_ident {
            pub use super::*;

            pub struct #builder_ident(#ident);

            impl super::#ident {
                pub fn builder(#(#arg)*) -> #builder_ident {
                    #builder_ident(#ident {
                        #(#decl),*
                    })
                }
            }

            impl #builder_ident {
                #(#setter)*

                pub fn build(self) -> #ident {
                    self.0
                }
            }
        }

        pub use #module_ident::#builder_ident;
    }
    .into())
}

// `Option<T>` to `T` if the incoming value is a `Option<T>`
fn extract_option_value(ty: &Type) -> Option<&Type> {
    if let Type::Path(p) = ty {
        if p.path.segments.len() == 1 && p.path.segments[0].ident == "Option" {
            if let syn::PathArguments::AngleBracketed(a) = &p.path.segments[0].arguments {
                if let syn::GenericArgument::Type(ty) = &a.args[0] {
                    return Some(ty);
                }
            }
        };
    }
    None
}
