package wap

import "github.com/mattrax/xml"

// ProvisioningDoc contains the manage client configuration
type ProvisioningDoc struct {
	XMLName        xml.Name         `xml:"wap-provisioningdoc"`
	Version        string           `xml:"version,attr"`
	Characteristic []Characteristic `xml:"characteristic"`
}

// Characteristic is a management client characteristic
type Characteristic struct {
	Type            string `xml:"type,attr,omitempty"`
	Params          []Parameter
	Characteristics []Characteristic `xml:"characteristic,omitempty"`
}

// Parameter is a management client parameter (setting) that is set on a characteristic
type Parameter struct {
	XMLName  xml.Name `xml:"parm"`
	Name     string   `xml:"name,attr,omitempty"`
	Value    string   `xml:"value,attr,omitempty"`
	DataType string   `xml:"datatype,attr,omitempty"`
}
